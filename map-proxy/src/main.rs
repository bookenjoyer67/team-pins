use actix_web::{web, App, HttpServer, HttpResponse, post};
use actix_files::Files;
use serde::Deserialize;
use jsonwebtoken::{encode, Header, EncodingKey};
use std::env;

#[derive(Deserialize)]
struct AuthRequest {
    scalar_token: String,
    user_id: Option<String>,
}

#[post("/auth")]
async fn auth(
    body: web::Json<AuthRequest>,
    jwt_secret: web::Data<String>,
) -> HttpResponse {
    let user_id = match &body.user_id {
        Some(id) => id.clone(),
        None => return HttpResponse::BadRequest().body("user_id required"),
    };

    let now = chrono::Utc::now().timestamp();
    let claims = serde_json::json!({
        "sub": user_id,
        "email": format!("{}@placeholder.matrix", user_id.replace(":", "_")),
        "aud": "authenticated",
        "role": "authenticated",
        "iat": now,
        "exp": now + 3600,
    });

    let token = match encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    ) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("JWT encoding error: {}", e);
            return HttpResponse::InternalServerError().body("JWT encoding failed");
        }
    };

    HttpResponse::Ok()
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .insert_header(("Access-Control-Allow-Headers", "Content-Type"))
        .json(serde_json::json!({
            "access_token": token,
            "user_id": user_id,
            "expires_in": 3600,
        }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let jwt_secret = "CHANGE_ME".to_string();
    let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3030".into());
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "../team-pins/dist".into());

    println!("Serving {} on {}", static_dir, bind_addr);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(jwt_secret.clone()))
            .service(auth)
            .service(Files::new("/", &static_dir).index_file("index.html"))
    })
    .bind(&bind_addr)?
    .run()
    .await
}
