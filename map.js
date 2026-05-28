import L from "leaflet";

import {
  encrypt_pin_data,
  decrypt_pin_data,
  encrypt_geojson,
  decrypt_geojson,
  encrypt_raw_bytes,
  decrypt_raw_bytes,
  generate_uuid,
  sign,
  verify,
} from "./core/pkg/e2e_core.js";
import * as DB from "./db.js";
import { state } from "./state.js";
import { addFreeDrawButton as _addFreeDraw, initFreeDraw } from "./freeDraw.js";
import { escapeHtml, toast, showProgressDialog, confirmDialog, promptRoomPassword, promptSetPassword, hashCommunityPassword } from "./dialogs.js";
import { t, getTutorialPin } from "./i18n.js";
import { playPinDrop, playSave, playUndo, playRedo } from "./sounds.js";
import { COLORS, colorPresetsHTML, hueDotHTML, hexInputHTML, wireColorPicker, validateHex } from "./helpers.js";
import { compute_geometry } from "./core/pkg/e2e_core.js";
import { getTrustWeight, computeAnnotationScore, trustScoreColor, computePinTrust, pinTrustIndicator } from "./trust.js";
import { showDiscoverModal, showLayersModal, loadLayersForSet } from "./map-layers.js";
import { showImportFromMapModal } from "./map-import.js";
import {
  loadSchemasForSet,
  renderSchemaFieldsById,
  collectSchemaData,
  buildCustomDataHTML,
  showSchemaManagerModal,
  showSchemaEditorModal,
} from "./map-schemas.js";

export { escapeHtml, toast };

const TUTORIAL_PINS = [
  // === Layer: Tutorial (opacity 1.0) — feature instruction only ===
  { lat:51.505,lng:-0.09,color:"#7c3aed",layer:"Tutorial",title:"Welcome to piggPin!",note:"piggPin is a peer-to-peer encrypted collaborative map — no accounts, no cloud. You write the map. You own the data. Everything is encrypted with X25519 + ChaCha20Poly1305 before it ever touches storage.\n\nThis tutorial introduces every feature. Click ▶ Slideshow to fly through all pins, or tap each one to learn a specific capability. Each pin lives in a layer — look at 📑 Layers to see how they're organized. Tutorial pins are full opacity; story pins are slightly transparent." },
  { lat:40.6892,lng:-74.0445,color:"#7c3aed",layer:"Tutorial",title:"Peer-to-Peer Sync",note:"Click 'Host Group' to generate a connection code, QR code, or shareable link. Peers connect directly via WebRTC — no server holds your data. Your map syncs automatically.\n\nJoin a peer by scanning their QR, pasting their connection string, or using a relay link. Peers auto-connect to each other in a mesh — not just to the host. Toggle 'Follow' to sync map position across connected peers." },
  { lat:35.6595,lng:139.7004,color:"#7c3aed",layer:"Tutorial",title:"Placing Pins",note:"Press 'N' or click the 📌 pin button, then click anywhere on the map. Each pin gets a title, description, color, emoji, and optional photo or video.\n\nIf your active layer has a schema (📋), the pin form shows custom typed fields — text, number, choice, date, time, boolean — instead of a generic note. Use Shift+click to multi-select. Ctrl+Z / Ctrl+Y to undo and redo." },
  { lat:-33.9628,lng:18.4098,color:"#7c3aed",layer:"Tutorial",title:"Drawing Shapes & Free Draw",note:"Use the toolbar on the left to draw polygons, polylines, rectangles, and circles. Click the free draw button to sketch any path freehand — great for marking trails or boundaries.\n\nAll shapes get automatic metrics: circumference, diameter, area, length, and perimeter. Toggle metric/imperial with a single click. Drawings support file attachments, custom colors, and arrow heads." },
  { lat:48.8566,lng:2.3522,color:"#7c3aed",layer:"Tutorial",title:"📑 Layers",note:"Layers organize pins into named categories within a map. Click 📑 Layers next to the map name. Each layer has:\n\n• A color for visual identification\n• Visibility toggle (👁) to show or hide its pins\n• Opacity slider to fade pins into the background\n• Click the layer name (●) to make it active — new pins land there. The tab bar shows → LayerName in the active color.\n\nDelete a layer and its pins reassign to the first remaining layer." },
  { lat:37.7749,lng:-122.4194,color:"#7c3aed",layer:"Tutorial",title:"📋 Schemas",note:"Schemas define custom pin forms with typed fields. Click 📋 Schemas, then + New Schema. Add fields: text for names, number for counts, choice for dropdowns, date for calendars, time for clocks, boolean for true/false.\n\nBind a schema to a layer in 📑 Layers — every new pin on that layer shows that custom form. Schemas are global: create once, reuse on any map. Keys auto-generate from field labels. Reorder fields with ▲▼." },
  { lat:39.9163,lng:116.3972,color:"#7c3aed",layer:"Tutorial",title:"Managing Maps & Export",note:"Click 🗺 Maps to see all your saved maps. Switch between them, rename, or delete. Each map has its own pins, drawings, layers, and encryption keys.\n\nExport any map as an encrypted .piggpin file — layers, schemas, custom data, and media all travel together. Import maps from files, shared links, or QR codes. Import layers from other maps via 📑 Layers → 📥." },
  { lat:30.0444,lng:31.2357,color:"#7c3aed",layer:"Tutorial",title:"Security & Key Rotation",note:"Every map has its own Data Encryption Key (DEK) wrapped by your personal X25519 key pair. All pins, drawings, and media are encrypted with ChaCha20Poly1305 client-side. Keys and plaintext never reach a server.\n\nUse 'Rotate Keys' to re-encrypt everything with a new DEK — old keys can no longer read new data. Export with an optional password for an extra layer of protection." },
  { lat:50.1109,lng:8.6821,color:"#7c3aed",layer:"Tutorial",title:"Relay Server & Self-Hosting",note:"A relay server helps peers connect behind firewalls and NAT. Open the drawer on the right → Settings → Relay to configure your ICE servers and WebSocket relay URL.\n\nHost your own signal relay to keep everything self-hosted and private. The Rust relay binary is included in signal-server/ — it handles WebSocket signaling, MQTT bridging, RNode bridging, and Reticulum bridging. Set usage limits, TTL expiration, and room passwords.\n\nOffline mesh: Meshtastic (USB/BLE), RNode (KISS/LoRa over WebSerial), and Reticulum (self-sovereign internet mesh) are supported." },
  // === Layer: Why This Matters (opacity 1.0) — historical lessons for decentralized cartography ===
  { lat:42.3710,lng:-83.0730,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Map the City Wouldn't Draw",tf:1968,tt:1971,note:"In 1968, geographer William Bunge moved to inner-city Detroit. Rather than exploring distant lands, he explored his own block. Working with community organizer Gwendolyn Warren, his Detroit Geographic Expedition produced maps of what the city refused to document: locations of pedestrian deaths from cars, rat bites reported by residents, machine gun positions in the neighborhood, and schools per child by zip code. The city's health department didn't collect rat-bite data. The transportation department didn't map where pedestrians died. Bunge's maps were arguments — for crosswalks, for pest control, for resource redistribution. He was later blacklisted as a communist.\n\nLesson: Your neighborhood doesn't exist on the official map until you put it there. piggPin exists so communities never wait for permission to document their own reality." },
  { lat:36.1630,lng:-95.9890,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Map Survivors Kept",tf:1921,tt:1921,note:"On May 31, 1921, a white mob — some deputized by city officials — attacked Greenwood District in Tulsa, Oklahoma, known as Black Wall Street. They burned 35 square blocks. Between 39 and 300 people were killed. 10,000 were left homeless. The massacre was erased from official records for eighty years. Survivors preserved hand-drawn maps of destroyed businesses, churches, and homes. They mapped where bodies were buried — locations absent from every city document. In the 2020s, those survivor maps finally guided archaeologists to mass graves.\n\nLesson: When institutions erase history, community records endure. piggPin's encryption means your spatial knowledge survives — no matter who tries to suppress it." },
  { lat:43.0130,lng:-83.6890,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Poison the State Said Was Fine",tf:2014,note:"On April 25, 2014, Flint, Michigan's water source was switched to the Flint River without corrosion treatment. Lead leached from aging pipes. Over 6,000 children were exposed. State officials repeatedly denied the problem — spokesman Brad Wurfel told Michigan Radio: 'Anyone who is concerned about lead in the drinking water in Flint can relax.'\n\nFlint resident LeeAnne Walters collected water samples showing lead seven times the EPA limit. Virginia Tech professor Marc Edwards ran a citizen-science study sampling hundreds of homes. Pediatrician Dr. Mona Hanna-Attisha mapped children's blood lead levels before and after the switch — proving the state was wrong. When state agencies denied reality, community science produced the spatial data that forced acknowledgment.\n\nLesson: The people living the crisis collect the data that power denies. piggPin puts that spatial evidence in your hands — encrypted, so whistleblowers are protected." },
  { lat:18.5333,lng:-72.3333,color:"#ef4444",layer:"Why This Matters",schema:null,title:"48 Hours to Map a Nation",tf:2010,tt:2010,note:"On January 12, 2010, a magnitude 7.0 earthquake struck Haiti. Over 100,000 people died. Before the quake, much of Haiti was unmapped on any digital platform. The UN, USAID, and search-and-rescue teams had no usable maps.\n\nWithin hours, OpenStreetMap volunteers worldwide began tracing satellite imagery — generously donated by GeoEye, DigitalGlobe, and others. Within 48 hours, they produced the first comprehensive street-level map of Port-au-Prince: collapsed bridges, displacement camps, functioning hospitals, blocked roads. This volunteer network outperformed every government agency. It was P2P mapping in practice, years before the term existed.\n\nLesson: When central infrastructure collapses, the network IS the map. piggPin builds this principle into its architecture — no server, no single point of failure, no agency that has to approve before you can act." },
  { lat:-22.9100,lng:-43.2000,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Double-Edged Map",note:"For decades, Rio de Janeiro's favelas — home to 25% of the city — appeared as blank spaces on official maps. No street names. No addresses. No mail delivery. No services. Residents couldn't prove they existed.\n\nIn response, residents built Wikimapa, crowdsourcing their own streets, businesses, and community landmarks. They mapped themselves into existence — and then the state mapped them for military occupation. The 2009 UPP pacification program used mapping to identify entry points, choke points, and gang-controlled zones. Being invisible on the map meant no services. Being visible meant surveillance.\n\nLesson: You need your data to exist — but not for the state to own it. piggPin's encrypted P2P model solves this paradox: your map exists within your trusted network and is cryptographically invisible to everyone else." },
  { lat:30.0300,lng:-90.7500,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Air the Regulators Breathe",note:"Cancer Alley is an 85-mile stretch of the Mississippi River between Baton Rouge and New Orleans with over 200 petrochemical plants. The EPA found cancer risks 47 times federal thresholds — and near one plant, 700 times the national average. The state's tumor registry uses geographic units too large to detect neighborhood-level clusters.\n\nSince the 1990s, community organizations — the Louisiana Bucket Brigade, Rise St. James (led by Goldman Prize winner Sharon Lavigne) — have conducted their own air monitoring, mapped toxic release sites, and correlated them with health outcomes. These community maps have stopped multiple petrochemical expansions, including Formosa Plastics' proposed $9.4 billion complex.\n\nLesson: When regulators won't monitor, communities must. piggPin stores environmental data encrypted — protecting monitors and whistleblowers from the industries that dominate local employment." },
  { lat:37.4215,lng:141.0325,color:"#ef4444",layer:"Why This Matters",schema:null,title:"120 Million Points of Light",tf:2011,note:"On March 11, 2011, the Fukushima Daiichi nuclear plant melted down. The Japanese government and TEPCO released radiation data widely considered incomplete and delayed. The very next day, three founders launched Safecast — a volunteer network building open-source Geiger counters (the bGeigie Nano) and mapping radiation across Japan from moving vehicles.\n\nBy 2020, Safecast accumulated over 120 million observations — the largest open dataset of background radiation ever collected. Independent validation found it highly correlated with US Department of Energy aerial survey data. In 2022, after Russia invaded Ukraine, Safecast deployed sensors in Chernobyl exclusion-zone areas, gathering over 300,000 readings.\n\nLesson: A decentralized network of volunteers with open-source hardware can produce higher-quality spatial data faster than a government-corporate complex with something to hide. piggPin adds encryption — critical in politically sensitive environmental crises." },
  { lat:9.8200,lng:167.4800,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Map Only the Maker Could Read",note:"For centuries, Marshallese navigators used stick charts — coconut midribs lashed together with shells tied at island positions — to map ocean swell patterns, not land. Each chart worked only for its maker: 'Individual navigator who made the chart was the only person who could fully interpret and use it.' The categories — mattang (teaching), meddo (regional), rebbelib (comprehensive) — encoded navigation knowledge passed father-to-son across generations.\n\nAfter World War II, the United States conducted 67 nuclear tests at Bikini Atoll. Displacement, reduced canoe travel, and electronic navigation destroyed the stick chart tradition within a single generation. A mapping system that survived centuries of Pacific exploration was erased by colonial technology and military violence.\n\nLesson: A map doesn't need to be legible to outsiders to be powerful. piggPin's encryption echoes the stick chart principle — data that is meaningful to the community that holds it and opaque to those who would misuse it." },
  { lat:31.9040,lng:35.2050,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Villages That Disappeared",note:"Since 2016, Google Maps has been documented as systematically underrepresenting Palestinian geography in the occupied West Bank. Palestinian village names, roads, and place markers are absent — while Israeli settlements, illegal under international law, are clearly labeled and navigable. The Green Line (1949 armistice line) isn't shown. Google uses algorithmic and policy justifications, but the effect is consistent: disappear Palestinian spatial existence from the world's most-used map. One billion users navigate a territory where one side's geography exists and the other's doesn't.\n\nLesson: When one corporation controls the map, entire populations can become cartographically illegible. piggPin's multi-source architecture means no single entity decides which places exist. Every community maintains its own markers. The map becomes a contested surface — not a pronouncement." },
  { lat:39.9570,lng:-75.2280,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Block the City Bulldozed",tf:1985,tt:1985,note:"On May 13, 1985, the Philadelphia Police Department dropped two bombs from a helicopter onto the MOVE organization's communal house at 6221 Osage Avenue. The fire killed six MOVE members and five children. It destroyed 65 neighboring homes — an entire city block. The fire department admitted under oath they let it burn.\n\nAfterward, the city rebuilt the site. Street numbers changed. Physical evidence was demolished. The block became a spatial lacuna — its destruction suppressed from official records. For decades, former residents maintained the memory: who lived where, where the bombs fell, where bodies were found, which houses burned first. Community-produced maps and oral testimony preserved what the city's bulldozers and lawyers tried to erase.\n\nLesson: The palimpsest — layers of meaning that persist even when the surface is rewritten — preserves what power bulldozes. piggPin holds each layer; no authority can delete a community's truth from the map." },
  { lat:-25.3444,lng:131.0369,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Continent That Was Sung",note:"For 50,000+ years, Aboriginal Australians navigated the continent using songlines — paths across land and sky traced by creator-beings during the Dreaming. Each songline encoded water sources, sacred sites, seasonal food locations, and territorial boundaries into song cycles. When sung in sequence, the melody described the topography. A knowledgeable person could navigate 3,500 km through desert by singing the right verses.\n\nBritish colonists found no paper maps and declared the continent terra nullius — nobody's land. In 1992, the Mabo decision overturned this fiction, but the epistemological violence continues. Mining companies still bulldoze sacred sites that exist in song but on no Western map. The 2020 destruction of Juukan Gorge — a 46,000-year-old site — happened because Rio Tinto's maps showed nothing there.\n\nLesson: The most sophisticated maps are sometimes sung, not drawn. piggPin's encrypted layers mirror the songline principle: knowledge held within trusted networks, invisible to those who would erase it." },
  { lat:51.4833,lng:-124.2167,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Map That Won a Nation",tf:2014,note:"For over a century, British Columbia claimed the Tsilhqot'in people had no legal title to their land. Then, in 2014, the Supreme Court of Canada unanimously declared Aboriginal title for the first time in Canadian history — 1,750 km² of traditional territory in the Nemiah Valley.\n\nThe evidence? Decades of community-produced maps: hunting routes, trap lines, village sites, burial grounds, spiritual locations. Chief Justice Beverley McLachlin wrote: 'The doctrine of terra nullius never applied in Canada.' Roger William, the Xeni Gwet'in chief who led the 30-year legal battle, proved that indigenous maps are legal documents — not folklore, not oral supplement, but evidence of sovereignty equal to any colonial deed.\n\nLesson: A community map, produced by the people who live on the land, can overturn centuries of legal fiction." },
  { lat:45.7500,lng:-101.2000,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Pipeline That Moved Twice",tf:2016,tt:2017,note:"In 2016, Energy Transfer Partners planned the Dakota Access Pipeline to cross the Missouri River north of Bismarck, North Dakota. The US Army Corps rejected that route — too close to the city's water supply. So they moved it. The new route crossed the river just half a mile upstream from the Standing Rock Sioux Reservation.\n\nThe Standing Rock Sioux Tribe mapped what was in the pipeline's path: sacred stone features, burial grounds, and treaty boundaries from 1851 and 1868. On November 3, 2016, 524 clergy members burned copies of the papal bulls that established the Doctrine of Discovery — explicitly connecting a 21st-century pipeline to a 15th-century cartographic-legal doctrine that declared non-Christian lands available for taking.\n\nLesson: Environmental risk was literally remapped from a predominantly white community onto indigenous land. Community spatial data — treaty maps, sacred site locations, water infrastructure — became the infrastructure of resistance." },
  { lat:63.7467,lng:-68.5170,color:"#ef4444",layer:"Why This Matters",schema:null,title:"A Country the Size of Mexico",tf:1999,note:"On April 1, 1999, the map of Canada changed for the first time since 1949. Nunavut separated from the Northwest Territories — 2,093,190 square kilometres, larger than Mexico, home to 36,000 people, 85% of them Inuit.\n\nThe boundaries were not drawn in Ottawa by distant administrators. They were negotiated over decades, informed by Inuit mapping of traditional hunting grounds, travel routes, and community locations. Inuit Tapiriit Kanatami, led by John Amagoalik — known as the father of Nunavut — used spatial data as a sovereignty tool. A 1982 plebiscite had supported the division. Inuktitut became an official language. The map was redrawn to reflect indigenous reality.\n\nLesson: Maps can be instruments of restitution, not just dispossession. Nunavut proves that borders can be negotiated, that territory can be returned, and that indigenous spatial knowledge can reshape a nation's geography." },
  { lat:-0.5000,lng:35.5000,color:"#ef4444",layer:"Why This Matters",schema:null,title:"4,000 Years on the Map",tf:2017,note:"The Ogiek people are among the oldest indigenous communities in East Africa — hunter-gatherers and honey-harvesters who have inhabited the Mau Forest of Kenya for over 4,000 years. The Kenyan government repeatedly evicted them, claiming they were destroying the watershed, while issuing land titles to politically-connected settlers and logging companies.\n\nIn 2017, the African Court on Human and Peoples' Rights ruled in the Ogiek's favour — the first indigenous land rights case decided by the court. The evidence? Community GIS mapping: beekeeping sites, sacred locations, hunting grounds, forest boundaries. Ogiek community organizations, supported by Minority Rights Group International, mapped their ancestral territory and proved sustainable stewardship that predates every modern state in the region. In 2022, the court ordered Kenya to pay reparations and formally recognize Ogiek indigeneity.\n\nLesson: Participatory mapping by the community — not external surveyors, not government agencies — was the evidence that won. The people who live on the land produced the map that proved they belong there." },
  { lat:31.7958,lng:35.1967,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Villages Erased from Time",tf:1948,note:"In 1948, over 500 Palestinian villages were depopulated and physically destroyed. Many were bulldozed and rebuilt over. Some were renamed with Hebrew place names. Approximately 750,000 Palestinians were expelled or fled.\n\nFor decades, these villages existed in refugee memory — hand-drawn maps, house keys, land deeds — but not on any official map of Israel. Palestinian researchers Walid Khalidi (All That Remains, 1992) and Salman Abu Sitta (Atlas of Palestine, 2010) painstakingly reconstructed the locations, populations, and land holdings of every destroyed village. The Israeli NGO Zochrot built an interactive map marking each site. Then, in 2011, Israel passed the Nakba Law, allowing the state to cut funding to institutions that commemorate the Nakba — making counter-mapping an act of direct political resistance.\n\nLesson: When the state makes spatial memory illegal, community maps preserve what was erased. The palimpsest holds each layer — the village that was there, the settlement that replaced it, and the memory that refuses erasure." },
  { lat:50.6800,lng:-120.3400,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Graves That Weren't on Any Map",tf:2021,note:"In May 2021, the Tk'emlúps te Secwépemc Nation announced that ground-penetrating radar had detected 215 unmarked children's graves at the former Kamloops Indian Residential School. Within months, similar discoveries followed across Canada.\n\nOver 139 residential schools operated from the 1880s through 1996, removing Indigenous children from their families under a policy the Truth and Reconciliation Commission later classified as cultural genocide. None of these schools appeared on standard government maps. The children who died at them — from tuberculosis, malnutrition, abuse, neglect — were buried in graves that did not appear on any map either. The cartographic absence was not accidental. It was part of the paper genocide — the systematic erasure of Indigenous presence from official records.\n\nThe TRC's 2015 final report explicitly called for mapping every school and every grave. Survivors had been saying where the bodies were for decades. They just needed someone to look.\n\nLesson: What is absent from the map is as political as what appears on it. Mapping the schools is now an act of truth and reconciliation — spatial evidence that can no longer be denied." },
  { lat:-13.5320,lng:-71.9675,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Library Made of Knots",tf:1583,tt:1583,note:"The Inca Empire managed a territory stretching 5,000 km along the Andes using quipus — knotted-cord recording devices. Using a decimal positional system, colour coding, and knot types, quipucamayocs (knot specialists) recorded census data, tax obligations, resource distribution, and spatial information. They could read by touch what others could not see.\n\nIn 1583, the Third Council of Lima ordered quipus burned as 'idolatrous objects' that recorded offerings to non-Christian gods. Of an estimated tens of thousands, only approximately 1,400 survive today. The largest collection — 298 quipus — is held at the Ethnological Museum in Berlin, thousands of kilometres from the Andes. The Spanish systematically destroyed Andean information infrastructure the same way they burned Maya codices.\n\nThe quipu was functionally encrypted: its multiple simultaneous encoding dimensions (colour, knot type, spatial position, fiber type) meant only the maker and their community could fully decode it.\n\nLesson: Five hundred years before PGP, the quipu proved that a community's data could be encoded in a format illegible to colonizers. piggPin's encryption is not new technology. It is a very old idea — data that speaks only to those who hold the key." },
  { lat:19.4326,lng:-99.1332,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Buried Metropolis",note:"Mexico City is built on top of Tenochtitlan, the Aztec capital founded in 1325 on an island in Lake Texcoco. At its peak, it held over 200,000 people — larger than any city in Europe at the time — connected by causeways and fed by aqueducts.\n\nWhen Hernán Cortés arrived in 1519, his soldiers described a city of gleaming temples and floating gardens rising from the water. Within two years, Tenochtitlan was destroyed, its stones repurposed to build the colonial capital. Today, its ruins are still being uncovered beneath the streets — the Templo Mayor, accidentally rediscovered by electrical workers in 1978, now sits beside the Metropolitan Cathedral. One city. Two worlds. Same ground." },
  { lat:-33.8568,lng:151.2153,color:"#ef4444",layer:"Why This Matters",schema:null,title:"The Oldest Continuous Culture",note:"You're looking at Sydney Harbour, the traditional land of the Gadigal people of the Eora Nation. Aboriginal Australians have lived here for over 60,000 years — making this one of the oldest continuous cultures on Earth.\n\nThe Gadigal fished these waters, managed the land with fire, and passed down complex oral traditions across thousands of generations. When the First Fleet arrived in 1788 and anchored in this harbour, two worldviews collided — one measured in millennia, the other in empire. The Opera House now sits on Bennelong Point, named for a Wangal man who became a mediator between those worlds." },
  // === Layer: Heritage (opacity 0.85) — Schema: Heritage Site ===
  { lat:29.9792,lng:31.1342,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🔺",custom:{year_built:"2560",status:"Standing",century:"Ancient",unesco:"true"},title:"Great Pyramid of Giza",tf:-2560,note:"Built ~2560 BCE for Pharaoh Khufu. Tallest structure on Earth for 3,800 years. 2.3 million stone blocks. Only surviving Ancient Wonder." },
  { lat:-13.1631,lng:-72.5450,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🦙",custom:{year_built:"1450",status:"Standing",century:"Ancient",unesco:"true"},title:"Machu Picchu",tf:1450,note:"Inca citadel high in the Andes, built ~1450. Abandoned during Spanish conquest, unknown to the outside world until Hiram Bingham's 1911 expedition. Precision stonework without mortar." },
  { lat:30.3285,lng:35.4444,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🏛️",custom:{year_built:"300",status:"Standing",century:"Ancient",unesco:"true"},title:"Petra",note:"Nabataean capital carved from rose-red sandstone cliffs. Thrived as a caravan city on the incense routes. Elaborate water management in the desert. The Treasury facade is 40m tall." },
  { lat:13.4125,lng:103.8670,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🛕",custom:{year_built:"1150",status:"Reconstructed",century:"Medieval",unesco:"true"},title:"Angkor Wat",tf:1150,note:"Largest religious monument on Earth, built by the Khmer Empire. Originally Hindu, later Buddhist. Surrounded by a 190m-wide moat. Intricate bas-reliefs span 1,200 square metres." },
  { lat:41.8902,lng:12.4922,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🏟️",custom:{year_built:"80",status:"Ruins",century:"Ancient",unesco:"true"},title:"Colosseum",tf:80,note:"Completed 80 CE under Titus. Held 50,000–80,000 spectators for gladiatorial contests and public spectacles. The hypogeum beneath the arena floor held animals and fighters in a complex lift system." },
  { lat:27.1751,lng:78.0421,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🕌",custom:{year_built:"1653",status:"Standing",century:"Medieval",unesco:"true"},title:"Taj Mahal",tf:1653,note:"Mughal emperor Shah Jahan built this marble mausoleum for his wife Mumtaz Mahal. 20,000 artisans worked for 22 years. The white marble appears to shift colour through the day." },
  { lat:-12.0393,lng:-77.0315,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"⛪",custom:{year_built:"1000",status:"Standing",century:"Medieval",unesco:"true"},title:"Historic Centre of Lima",note:"Founded by Pizarro in 1535 as the 'City of Kings.' The Plaza Mayor, Cathedral, and San Francisco monastery with its catacombs hold 500 years of colonial and indigenous history." },
  { lat:-8.9580,lng:39.5130,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🏚️",custom:{year_built:"1200",status:"At Risk",century:"Medieval",unesco:"true"},title:"Kilwa Kisiwani",note:"Medieval Swahili trading city on the Tanzanian coast. Connected Africa to Arabia, Persia, India, and China. Coins minted here have been found across the Indian Ocean, from Arabia to Southeast Asia. Now a haunting ruin on a mangrove island." },
  { lat:-20.1597,lng:57.5029,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🧱",custom:{year_built:"1849",status:"Standing",century:"Industrial",unesco:"true"},title:"Aapravasi Ghat",note:"Between 1834 and 1920, nearly half a million people passed through this stone immigration depot in Port Louis, Mauritius. They came from India — not as free migrants, but as indentured labourers, recruited under a system that replaced slavery after abolition across the British Empire. Many were deceived about the terms. Many never returned.\n\nThe British called it the 'Great Experiment.' Those who survived the brutal plantation conditions built new lives on the island, and their descendants now form the majority of Mauritius' population. Aapravasi Ghat is a UNESCO World Heritage site — not because the system was noble, but because the people who endured it must be remembered." },
  { lat:50.8261,lng:-0.1775,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🏰",custom:{year_built:"1787",status:"Standing",century:"Industrial",unesco:"false"},title:"Royal Pavilion",note:"George IV's seaside fantasy in Brighton — an Indo-Saracenic confection of minarets, domes, and chinoiserie interiors built between 1787–1823. A Grade I listed Regency oddity that defies architectural category." },
  { lat:60.0069,lng:11.5082,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🪵",custom:{year_built:"1190",status:"Standing",century:"Medieval",unesco:"false"},title:"Heddal Stave Church",note:"Norway's largest stave church, built entirely of pine around 1200. A triple-nave masterpiece of Viking-era craftsmanship — dragon heads on the gables and carved portals blending pagan and Christian motifs." },
  { lat:13.9057,lng:-4.5552,color:"#eab308",layer:"Heritage",schema:"heritage",emoji:"🕌",custom:{year_built:"1907",status:"Standing",century:"Medieval",unesco:"true"},title:"Great Mosque of Djenné",note:"The largest mud-brick building in the world, in Djenné, Mali. The current structure dates to 1907, but a mosque has stood on this site since the 13th century, when Djenné was a center of Islamic learning and a key node in the trans-Saharan trade network.\n\nCaravans of camels carried gold, salt, ivory, and manuscripts across the desert, linking West Africa to the Mediterranean and beyond. Each year, the entire community replasters the mosque in a festival called the Crépissage — a living tradition of collective maintenance that has survived empires, colonialism, and modern states." },
  // === Layer: Nature (opacity 0.8) — Schema: Natural Feature ===
  { lat:36.1069,lng:-112.1129,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🏜️",custom:{feature_type:"Canyon",elevation_m:"1600",protected:"true",best_season:"Spring"},title:"Grand Canyon",note:"Carved by the Colorado River over 5–6 million years. 446km long, up to 29km wide, 1.8km deep. Exposes nearly two billion years of Earth's geological history in its layered walls." },
  { lat:-18.2871,lng:147.6997,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🐠",custom:{feature_type:"Reef",elevation_m:"0",protected:"true",best_season:"Year-round"},title:"Great Barrier Reef",note:"World's largest coral reef system — 2,900 reefs, 900 islands, 2,300km long. Visible from space. Home to 1,500 fish species. Under severe threat from warming oceans and coral bleaching." },
  { lat:-25.6953,lng:-54.4367,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"💧",custom:{feature_type:"Waterfall",elevation_m:"180",protected:"true",best_season:"Summer"},title:"Iguazu Falls",note:"275 individual waterfalls spanning 2.7km along the Argentina-Brazil border. Taller than Niagara and wider than Victoria. The Devil's Throat drops 82 metres into a perpetual cloud of mist." },
  { lat:-3.0674,lng:37.3556,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🗻",custom:{feature_type:"Mountain",elevation_m:"5895",protected:"true",best_season:"Summer"},title:"Mount Kilimanjaro",note:"Africa's highest peak — a dormant volcano with five climate zones from rainforest to arctic summit. The glaciers that crowned it for 11,000 years may vanish by 2050." },
  { lat:-3.4653,lng:-62.2159,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🌳",custom:{feature_type:"Forest",elevation_m:"100",protected:"false",best_season:"Year-round"},title:"Amazon Rainforest",note:"5.5 million km² across nine countries. 10% of all known species. 390 billion trees. A vital carbon sink and hydrological engine — the Amazon River discharges more water than the next seven largest rivers combined." },
  { lat:-17.9244,lng:25.8567,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🌈",custom:{feature_type:"Waterfall",elevation_m:"885",protected:"true",best_season:"Spring"},title:"Victoria Falls",note:"Known locally as Mosi-oa-Tunya — 'The Smoke That Thunders.' 1,708m wide, 108m drop. The world's largest sheet of falling water. Spray rises 400m and can be seen 50km away." },
  { lat:44.4280,lng:-110.5885,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🌋",custom:{feature_type:"Mountain",elevation_m:"2500",protected:"true",best_season:"Summer"},title:"Yellowstone",note:"World's first national park (1872). Sits atop a supervolcano. Half of the world's geothermal features: geysers, hot springs, fumaroles. Old Faithful erupts every 60–110 minutes." },
  { lat:31.1320,lng:-8.6194,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🐪",custom:{feature_type:"Desert",elevation_m:"150",protected:"false",best_season:"Autumn"},title:"Erg Chebbi",note:"Morocco's iconic golden dunes rise to 150m. Part of the Sahara, the world's largest hot desert at 9.2 million km². Sand seas, oases, and ancient caravan routes that once carried salt and gold." },
  { lat:54.6000,lng:-2.5000,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🏞️",custom:{feature_type:"Mountain",elevation_m:"978",protected:"true",best_season:"Summer"},title:"Lake District",note:"England's largest national park — glacial valleys, 16 lakes, and England's highest peak (Scafell Pike, 978m). Inspired Wordsworth, Coleridge, and Beatrix Potter. Over 3,000km of footpaths." },
  { lat:79.4700,lng:11.3000,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🐻‍❄️",custom:{feature_type:"Glacier",elevation_m:"0",protected:"true",best_season:"Summer"},title:"Svalbard",note:"Norwegian archipelago halfway to the North Pole. More polar bears than people. The Global Seed Vault stores backup seeds from gene banks worldwide in permafrost — a doomsday library for biodiversity." },
  { lat:-22.9500,lng:-43.2800,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🌳",custom:{feature_type:"Forest",elevation_m:"500",protected:"true",best_season:"Year-round"},title:"Tijuca Forest",note:"The world's largest urban forest, covering 32 square kilometres within Rio de Janeiro. But it wasn't always here. In the 1860s, after decades of coffee plantations had stripped the land bare and threatened the city's water supply, Emperor Pedro II ordered a massive reforestation. Over 100,000 seedlings were planted by hand — mostly by enslaved and formerly enslaved workers. Today, the forest shelters capuchin monkeys, toucans, sloths, and over 1,600 plant species. It is one of the first large-scale ecological restoration projects in history — a reminder that what was taken can sometimes be returned." },
  { lat:-1.2921,lng:36.8219,color:"#16a34a",layer:"Nature",schema:"natural",emoji:"🦴",custom:{feature_type:"Mountain",elevation_m:"1600",protected:"true",best_season:"Year-round"},title:"Great Rift Valley",note:"A 6,000-kilometre tectonic divide stretching from Lebanon to Mozambique, formed as the African plate slowly tears apart. The fossil beds at Olduvai Gorge in Tanzania and the shores of Lake Turkana in Kenya have yielded some of the earliest hominin remains: Homo habilis, Paranthropus boisei, and Homo erectus. These discoveries rewrote the story of human origins, pushing it deeper into the past and firmly rooting it in African soil. The Rift is not just a scar in the Earth — it is where we began." },
  // === Layer: Urban (opacity 0.7) — Schema: City Note ===
  { lat:35.6595,lng:139.7004,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🚦",custom:{observation_type:"Transport",rating:"5",visited:"2025-10-15",recommend:"true"},title:"Shibuya Crossing",note:"Tokyo's iconic scramble crossing — up to 3,000 people at once. Hachikō statue at the station: the Akita who waited nine years for his owner. Neon, noise, and the rhythm of the world's largest city." },
  { lat:51.5190,lng:-0.1336,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🧀",custom:{observation_type:"Market",rating:"4",visited:"2024-03-20",recommend:"true"},title:"Borough Market",note:"London's oldest food market, trading on this site since at least 1276. Under the railway arches near London Bridge. The globe theatre is a five-minute walk — Shakespeare likely shopped here." },
  { lat:48.8867,lng:2.3431,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🎨",custom:{observation_type:"Architecture",rating:"5",visited:"2024-09-10",recommend:"true"},title:"Montmartre",note:"The hill of Paris where the Sacré-Cœur watches over the city. Once a village of windmills and vineyards, then the studio of Renoir, Picasso, and Van Gogh. Still holding onto its crooked, cobbled independence." },
  { lat:41.0082,lng:28.9784,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🕌",custom:{observation_type:"Market",rating:"5",visited:"2025-03-18",recommend:"true"},title:"Grand Bazaar",note:"Istanbul's covered market, operating since 1461. 4,000 shops across 61 streets. One of the world's oldest and largest covered markets. The scent of spices, leather, and strong tea fills the air." },
  { lat:47.6062,lng:-122.3407,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🐟",custom:{observation_type:"Market",rating:"4",visited:"2024-06-05",recommend:"true"},title:"Pike Place Market",note:"Seattle's century-old public market overlooking Elliott Bay. Fishmongers throw salmon. The original Starbucks sits across the street. Below the market, the gum wall is a strangely beloved attraction." },
  { lat:28.6562,lng:77.2318,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🍛",custom:{observation_type:"Market",rating:"4",visited:"2023-11-14",recommend:"true"},title:"Chandni Chowk",note:"Old Delhi's chaotic, glorious artery. Laid out in 1650 by Shah Jahan's daughter. Silver shops, spice markets, street food stalls that have served the same recipe for generations. The lane of parathas." },
  { lat:-34.6310,lng:-58.4100,color:"#2563eb",layer:"Urban",schema:"city",emoji:"💃",custom:{observation_type:"Architecture",rating:"5",visited:"2022-09-01",recommend:"true"},title:"La Boca",note:"Buenos Aires' working-class port neighbourhood. Italian immigrants built homes from shipyard scraps and painted them in bright, clashing colours. Now a warren of tango, art, and defiant joy." },
  { lat:22.3193,lng:114.1694,color:"#2563eb",layer:"Urban",schema:"city",emoji:"⛴️",custom:{observation_type:"Transport",rating:"4",visited:"2025-01-20",recommend:"true"},title:"Star Ferry",note:"Hong Kong's green-and-white ferries have crossed Victoria Harbour since 1888. A six-minute journey between Kowloon and Central — one of the world's great commutes, with the skyline unfolding on both sides." },
  { lat:55.6761,lng:12.5683,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🚲",custom:{observation_type:"Architecture",rating:"5",visited:"2023-07-12",recommend:"true"},title:"Nyhavn",note:"Copenhagen's 17th-century waterfront — once a rough sailors' district where Hans Christian Andersen lived. Now the candy-coloured townhouses are postcard-famous, but the harbour still holds its maritime soul." },
  { lat:19.0760,lng:72.8777,color:"#2563eb",layer:"Urban",schema:"city",emoji:"🍱",custom:{observation_type:"Food",rating:"5",visited:"",recommend:"true"},title:"Mumbai Dabbawalas",note:"Every morning, over 5,000 dabbawalas — lunch delivery workers — collect 200,000 home-cooked meals from suburban kitchens and deliver them to offices across Mumbai. They use bicycles, hand carts, and the commuter rail system.\n\nThe meals are sorted and routed using a colour-coded system of symbols painted on the lids — no barcodes, no apps, no GPS. Harvard Business School studied them and found an error rate of roughly 1 in 16 million deliveries. They have operated continuously for over 130 years, through monsoons, strikes, and a pandemic. Just a deeply organized network of people who know their city better than any algorithm." },
  // === Layer: Festivals (opacity 0.6) — Schema: Festival ===
  { lat:-22.9083,lng:-43.1964,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🎭",custom:{month:"Feb",duration_days:"5",attendance:"2000000",free_entry:"true"},title:"Carnival — Rio de Janeiro",note:"The world's largest carnival. Samba schools spend the entire year preparing for 80 minutes in the Sambódromo. Over 2 million people fill the streets daily. A city that transforms into a single, breathing rhythm." },
  { lat:48.1351,lng:11.5820,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🍺",custom:{month:"Sep",duration_days:"16",attendance:"6000000",free_entry:"false"},title:"Oktoberfest — Munich",tf:1810,note:"Started as a royal wedding celebration in 1810. Now 6 million visitors drink 7 million litres of beer across 16 days. Traditional Bavarian brass bands and dirndls. The largest Volksfest in the world." },
  { lat:25.2820,lng:83.0050,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🪔",custom:{month:"Oct",duration_days:"5",attendance:"1000000",free_entry:"true"},title:"Diwali — Varanasi",note:"The festival of lights along the oldest living city on Earth. Thousands of diyas float on the Ganges at sunset. Fireworks echo off the ghats. A celebration of light over darkness that predates recorded history." },
  { lat:17.0596,lng:-96.7266,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"💀",custom:{month:"Nov",duration_days:"2",attendance:"200000",free_entry:"true"},title:"Día de Muertos — Oaxaca",note:"Not a Halloween imitation but a pre-Hispanic tradition blending with Catholicism. Families build ofrendas, cemeteries glow with marigolds and candles. The dead are welcomed home for one night." },
  { lat:27.4793,lng:77.6833,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🎨",custom:{month:"Mar",duration_days:"2",attendance:"500000",free_entry:"true"},title:"Holi — Mathura",note:"The birthplace of Krishna erupts in colour. Strangers throw gulal powder, water balloons, and joy. Social hierarchies dissolve under layers of pink, blue, and green. A festival older than most modern borders." },
  { lat:39.4192,lng:-0.3244,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🍅",custom:{month:"Aug",duration_days:"1",attendance:"20000",free_entry:"false"},title:"La Tomatina — Buñol",tf:1945,note:"A small Spanish town of 9,000 floods with 20,000 people and 150,000 kilos of overripe tomatoes. For exactly one hour, the streets become a river of red pulp. How it started: a childish street brawl in 1945." },
  { lat:13.7563,lng:100.5018,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🔫",custom:{month:"Apr",duration_days:"3",attendance:"500000",free_entry:"true"},title:"Songkran — Bangkok",note:"Thai New Year — the world's biggest water fight. Originally a gentle ritual of pouring water over elders' hands for blessings. Now the streets of Bangkok become a citywide aquatic battle for three days." },
  { lat:55.9533,lng:-3.1883,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🎪",custom:{month:"Aug",duration_days:"25",attendance:"3500000",free_entry:"false"},title:"Edinburgh Fringe",tf:1947,note:"The world's largest arts festival. 3,500 shows, 50,000 performances, 300 venues. A former school hall, a pub basement, a parked taxi — everything becomes a stage. The city doubles in population for August." },
  { lat:35.0210,lng:135.7601,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"🏮",custom:{month:"Jul",duration_days:"30",attendance:"1000000",free_entry:"true"},title:"Gion Matsuri — Kyoto",tf:869,note:"Japan's most famous festival, running since 869 CE — originally a purification ritual to appease gods during a plague. The grand parade of yamaboko floats, some weighing 12 tonnes, threads through Kyoto's narrow streets." },
  { lat:12.0350,lng:39.0470,color:"#ec4899",layer:"Festivals",schema:"festival",emoji:"✝️",custom:{month:"Jan",duration_days:"3",attendance:"100000",free_entry:"true"},title:"Timkat — Lalibela",note:"Ethiopian Orthodox celebration of Epiphany at the rock-hewn churches of Lalibela — carved downward into solid volcanic stone in the 12th century. Priests carry replica Arks of the Covenant. A 3-day immersion in incense, chant, and white robes." },
];

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function checkStorageQuota(neededBytes, label) {
  try {
    const est = await navigator.storage.estimate();
    const free = est.quota - est.usage;
    if (neededBytes > free * 0.9) {
      const mbFree = Math.round(free / 1024 / 1024);
      const mbNeed = Math.round(neededBytes / 1024 / 1024);
      toast(
        `Low storage: ${mbNeed}MB ${label}, only ${mbFree}MB free`,
        "#f97316",
      );
    }
  } catch (_) {}
}

async function compressMedia(file) {
  if (
    !file.type.startsWith("image/") ||
    file.type.includes("gif") ||
    file.type.includes("svg") ||
    file.type.startsWith("video/")
  ) {
    return {
      buffer: await file.arrayBuffer(),
      type: file.type,
      name: file.name,
    };
  }
  try {
    const bitmap = await createImageBitmap(file);
    let w = bitmap.width,
      h = bitmap.height;
    if (w > 1920 || h > 1920) {
      const ratio = Math.min(1920 / w, 1920 / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    let blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.8),
    );
    if (!blob) {
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
    }
    if (!blob) throw new Error("toBlob returned null");
    const ext = blob.type === "image/webp" ? ".webp" : ".jpg";
    return {
      buffer: await blob.arrayBuffer(),
      type: blob.type,
      name: file.name.replace(/\.[^.]+$/, ext),
    };
  } catch (_) {
    return {
      buffer: await file.arrayBuffer(),
      type: file.type,
      name: file.name,
    };
  }
}

export async function compressVideoBytes(bytes, mimeType, fileName) {
  const MAX_DIM = 1280;
  const BITRATE = 1_500_000;
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const video = document.createElement("video");
  video.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
  video.src = blobUrl;
  video.preload = "auto";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  document.body.appendChild(video);
  let failReason = null;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => {
        failReason = "codec not supported";
        reject(new Error("decode"));
      };
      setTimeout(() => {
        failReason = "timeout";
        reject(new Error("timeout"));
      }, 15000);
    });
    const vw = video.videoWidth,
      vh = video.videoHeight;
    if (!vw || !vh || video.duration < 0.5) {
      URL.revokeObjectURL(blobUrl);
      video.remove();
      return { buffer: bytes.slice(0), type: mimeType, name: fileName };
    }
    let w = vw,
      h = vh;
    if (w > MAX_DIM || h > MAX_DIM) {
      const r = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    w = w - (w % 2);
    h = h - (h % 2);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const canvasStream = canvas.captureStream(30);
    let audioTracks = [];
    try {
      const vs = video.captureStream();
      audioTracks = vs.getAudioTracks();
    } catch (_) {}
    const combined = audioTracks.length
      ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
      : canvasStream;
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
    const chunks = [];
    const recorder = new MediaRecorder(combined, {
      mimeType: mime,
      videoBitsPerSecond: BITRATE,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise((r) => {
      recorder.onstop = r;
    });
    recorder.start(250);
    video.currentTime = 0;
    video.muted = true;
    video.volume = 0;
    await video.play();
    const draw = () => {
      if (!video.paused && !video.ended) {
        ctx.drawImage(video, 0, 0, w, h);
        requestAnimationFrame(draw);
      }
    };
    draw();
    await Promise.race([
      new Promise((r) => {
        video.addEventListener("ended", r, { once: true });
      }),
      new Promise((r) => setTimeout(r, (video.duration || 60) * 1000 + 5000)),
    ]);
    recorder.stop();
    await stopped;
    video.pause();
    video.remove();
    URL.revokeObjectURL(blobUrl);
    const blob = new Blob(chunks, { type: recorder.mimeType });
    return {
      buffer: new Uint8Array(await blob.arrayBuffer()),
      type: recorder.mimeType,
      name: fileName.replace(/\.[^.]+$/, ".webm"),
      compressed: true,
    };
  } catch (_) {
    URL.revokeObjectURL(blobUrl);
    video.remove();
    return {
      buffer: bytes.slice(0),
      type: mimeType,
      name: fileName,
      compressed: false,
      reason: failReason,
    };
  }
}

export function initMap() {
  const map = L.map("map-container", {
    preferCanvas: true,
    inertia: true,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    attributionControl: false,
  }).setView([51.505, -0.09], 5);
  const osm = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19 },
  );
  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    },
  );
  osm.addTo(map);
  L.control
    .layers({ [t("street")]: osm, [t("satellite")]: satellite }, null, {
      position: "topleft",
    })
    .addTo(map);
  L.control
    .attribution({ prefix: false })
    .addAttribution(
      '🌍 | 🌐 | &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    )
    .addTo(map);
  state.map = map;

  // Streetview button — positioned right below the layer toggle
  if (!window._isEmbed) {
    const svBtn = L.DomUtil.create("button", "leaflet-control");
    svBtn.textContent = "🚶";
    svBtn.title = `${t("streetView")}`;
    svBtn.style.cssText = "width:32px;height:32px;border:none;border-radius:4px;background:#059669;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
    svBtn.onclick = (e) => {
      e.stopPropagation();
      state.streetViewing = !state.streetViewing;
      svBtn.style.background = state.streetViewing ? "#047857" : "#059669";
      state.map.getContainer().style.cursor = state.streetViewing ? "crosshair" : "";
    };
    const layersCtrl = map.getContainer().querySelector(".leaflet-control-layers");
    if (layersCtrl) layersCtrl.after(svBtn);
    else map.getContainer().appendChild(svBtn);
  }
  state.clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 15,
  }).addTo(map);

  const peerMarkerGroup = L.layerGroup().addTo(map);
  window._peerMarkerGroup = peerMarkerGroup;
  window._renderPeerMarkers = () => {
    peerMarkerGroup.clearLayers();
    const locs = window._peerLocations;
    if (!locs || !state.currentSet || !state.map) return;
    const now = Date.now();
    for (const [, loc] of locs) {
      if (loc.team_id !== state.currentSet) continue;
      if (now - loc.ts > 120000) continue;
      const marker = L.circleMarker([loc.lat, loc.lng], {
        radius: 6,
        color: "#2563eb",
        fillColor: "#2563eb",
        fillOpacity: 0.4,
        weight: 2,
        interactive: true,
      });
      marker.bindTooltip(loc.name, { direction: "top", offset: [0, -8], opacity: 0.9 });
      marker.addTo(peerMarkerGroup);
    }
  };

  window._showDiscoveryBanner = (results) => {
    if (!results || results.length === 0 || !state.map) return;
    const existing = document.getElementById("gossip-discovery-banner");
    if (existing) existing.remove();
    const banner = L.DomUtil.create("div");
    banner.id = "gossip-discovery-banner";
    banner.style.cssText = "position:absolute;bottom:50px;left:50%;transform:translateX(-50%);z-index:1001;padding:8px 14px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:6px;box-shadow:0 2px 12px var(--shadow);font-size:12px;white-space:nowrap;cursor:pointer;";
    const pc = results[0].pin_count;
    const pinLabel = pc === "?" ? "" : pc > 0 ? ` — ${pc} pin${pc !== 1 ? "s" : ""} nearby` : "";
    banner.innerHTML = `🔍 ${escapeHtml(results[0].name)}${pinLabel} `;
    const dismiss = L.DomUtil.create("span");
    dismiss.textContent = "✕";
    dismiss.style.cssText = "margin-left:6px;color:var(--text-dim);cursor:pointer;";
    dismiss.onclick = (e) => { e.stopPropagation(); banner.remove(); };
    banner.appendChild(dismiss);
    banner.onclick = () => { banner.remove(); showDiscoverModal(); };
    state.map.getContainer().appendChild(banner);
    setTimeout(() => banner.remove(), 10000);
  };

  let moveTimer;
  map.on("moveend", () => {
    if (state.suppressMapSync) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(async () => {
      if (state.currentSet)
        await DB.saveSettings(state.currentSet, {
          map_center: [map.getCenter().lat, map.getCenter().lng],
          map_zoom: map.getZoom(),
        });
      if (state.followMap)
        window._broadcast?.("map_view", {
          center: [map.getCenter().lat, map.getCenter().lng],
          zoom: map.getZoom(),
        });
      import("./gossip.js").then(g => g.notifyMapPan(map.getCenter().lat, map.getCenter().lng, map.getZoom())).catch(() => {});
    }, 500);
  });

  map.on("popupopen", (e) => {
    const el = e.popup?.getElement();
    if (!el) return;
    const pinEl = el.querySelector("[data-pin-id]");
    if (pinEl) renderAnnotationThread(pinEl.dataset.pinId);
  });

  map.on("popupclose", (e) => {
    const el = e.popup?.getElement();
    if (!el) return;
    const media = el.querySelectorAll("img[src^='blob:'], video[src^='blob:']");
    for (const m of media) URL.revokeObjectURL(m.src);
  });

  // Pin placement + streetview click handler (always active)
  map.on("click", (e) => {
    if (state.streetViewing) {
      state.streetViewing = false;
      state.map.getContainer().style.cursor = "";
      const svBtn = map.getContainer().querySelector("button[title*=\"Street\" i]");
      if (svBtn) svBtn.style.background = "#059669";
      window.open(
        `https://www.mapillary.com/app/?lat=${e.latlng.lat}&lng=${e.latlng.lng}&z=17&focus=map`,
        "_blank",
      );
      return;
    }
    if (!state.placingPin) return;
    state.placingPin = false;
    state.map.getContainer().style.cursor = "";
    showPinForm(e.latlng.lat, e.latlng.lng);
  });

  // Double-tap to fullscreen on mobile
  map.getContainer().addEventListener("dblclick", (e) => {
    if (!window.matchMedia("(max-width: 768px)").matches) return;
    if (state.placingPin || state.freeDrawing || state.measuring || state._selectionActive || state.streetViewing) return;
    e.stopPropagation();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });

  // Periodic TTL expiry check
  if (state._ttlInterval) clearInterval(state._ttlInterval);
  state._ttlInterval = setInterval(async () => {
    if (!state.dek || !state.currentSet) return;
    const gov = {
      ttl_enabled: false,
      ...(state.currentCommunity?.governance || {}),
    };
    if (!gov.ttl_enabled) return;
    const now = Date.now();
    let changed = false;
    const markers = [...state.markers];
    for (const marker of markers) {
      if (marker._ttlExpiresAt && marker._ttlExpiresAt < now) {
        try {
    await DB.deletePin(marker._pinId);
    window._broadcast?.("delete_pin", { pin_id: marker._pinId });
  } catch (_) { /* marker may already be deleted */ }
        changed = true;
      }
    }
    if (changed) {
      await loadPins();
      window._renderUI?.();
    }
  }, 30000);
}

export function pinIcon(c, emoji) {
  if (emoji) {
    return L.divIcon({
      className: "emoji-pin",
      html: `<div style="font-size:28px;text-align:center;line-height:36px;">${escapeHtml(String(emoji))}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
    });
  }
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36"><path fill="${c}" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z"/><circle fill="#fff" cx="12" cy="12" r="4"/></svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml,${encodeURIComponent(s)}`,
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36],
  });
}

export async function loadSetList() {
  const a = await DB.getAllTeams(),
    n = {};
  a.forEach((t) => (n[t.team_id] = t.name));
  window._names = n;
}

export async function switchSet(sid) {
  if (state.currentSet === sid) return;
  window._clearVotedPins?.(state.currentSet);
  if (state._ttlInterval) { clearInterval(state._ttlInterval); state._ttlInterval = null; }
  state.currentSet = sid;
  state.activeLayerId = null;
  localStorage.setItem("activeSet", sid);
  state.dek = null;
  state.currentCommunity = null;
  window._clearHistory?.();
  state.markers.forEach((m) => m.remove());
  state.markers.length = 0;
  state.clusterGroup?.clearLayers();
  state._markerMap = null;
  state.drawingLayers.forEach((l) => state.map.removeLayer(l));
  state.drawingLayers.length = 0;
  state.chainLayers.forEach((l) => state.map.removeLayer(l));
  state.chainLayers.length = 0;
  window._peerMarkerGroup?.clearLayers();
  const t = await DB.getTeam(sid);
  if (t) state.dek = window._unwrap_dek(t.wrapped_dek, t.secret_key);
  state.currentCommunity = await DB.getCommunity(sid);
  await loadLayersForSet(sid);
  await loadSchemasForSet(sid);
  const s = await DB.getSettings(sid);
  if (s && s.map_center && state.map) {
    state.suppressMapSync = true;
    state.map.setView(s.map_center, s.map_zoom || 5);
    setTimeout(() => {
      state.suppressMapSync = false;
    }, 600);
  }
  await loadPins();
  await loadDrawings();
  await loadChains();
  window._renderUI?.();
  window._renderPeerMarkers?.();
  if (window._pendingMapView && state.map) {
    state.suppressMapSync = true;
    state.map.setView(
      window._pendingMapView.center,
      window._pendingMapView.zoom,
    );
    delete window._pendingMapView;
    setTimeout(() => {
      state.suppressMapSync = false;
    }, 600);
  }
  window._broadcast?.("sync_request");

  if (window._relayIsConnected?.()) {
    window._relaySyncDelta?.(sid).then(() => {
      loadPins();
      loadDrawings();
    }).catch(() => {});
  }
}

export async function createSet(name) {
  const sid = generate_uuid();
  const kp = window._generate_user_keypair();
  const dk = window._generate_dek();
  await DB.saveTeam({
    team_id: sid,
    name,
    public_key: window._encode_hex(kp.public),
    secret_key: window._encode_hex(kp.secret),
    wrapped_dek: window._wrap_dek(dk, window._encode_hex(kp.public)),
  });
  await DB.saveCommunity({
    community_id: sid,
    name,
    description: "",
    genesis_public_key: state.signingPublicKey || "",
    genesis_created_at: Date.now(),
    members: state.signingPublicKey ? [{
      pubkey: state.signingPublicKey,
      display_name: state.displayName,
      role: "founder",
      joined_at: Date.now(),
      vouched_by: null,
    }] : [],
    governance: {
      contribution: "open",
      validation: "none",
      schema_authority: "any_member",
      key_rotation: "founder_only",
      fork_policy: "allowed",
      join_policy: "open",
      ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360,
      ttl_min_mins: 60, ttl_max_mins: 43200, anonymous_posting: "forbidden",
    },
    bounds: null,
    relay_nodes: [],
    visibility: "local",
  });
  window._names[sid] = name;
  const defaultLayer = { layer_id: generate_uuid(), name: "Default", color: state.defaultLayerColor, visible: true, opacity: 1.0 };
  await DB.saveLayers(sid, [defaultLayer]);
  await switchSet(sid);
  await loadSetList();
}

export async function showCommunityDetails(communityId) {
  const c = await DB.getCommunity(communityId);
  if (!c) { toast("Community not found", "#dc2626"); return; }

  const isFounder = (c.members || []).some(m => m.pubkey === state.signingPublicKey && m.role === "founder");

  const memberRows = (c.members || []).map(m => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-light);">
      <span style="font-size:12px;">${escapeHtml(m.display_name)}</span>
      <span style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:11px;color:var(--text-dim);padding:1px 6px;border:1px solid var(--border);border-radius:3px;">${escapeHtml(m.role)}</span>
        ${isFounder && m.role !== "founder" ? `<button class="cd-remove-btn" data-pubkey="${escapeHtml(m.pubkey)}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;line-height:1;">×</button>` : ""}
      </span>
    </div>
  `).join("") || '<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:8px;">No members</div>';

  const gov = {
    contribution: "open", validation: "none", schema_authority: "any_member",
    key_rotation: "founder_only", fork_policy: "allowed", join_policy: "open",
    ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360,
    ttl_min_mins: 60, ttl_max_mins: 43200, anonymous_posting: "forbidden",
    ...(c.governance || {}),
  };
  
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:360px;max-width:440px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
      <h3 style="margin:0;">📋 ${escapeHtml(c.name)}</h3>
      <button id="cd-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div style="flex:1;overflow-y:auto;min-height:0;">
    ${c.description ? `<p style="font-size:12px;color:var(--text-dim);margin:0 0 8px;">${escapeHtml(c.description)}</p>` : ""}
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
      ID: ${escapeHtml(c.community_id.slice(0, 12))}... · Genesis: ${escapeHtml((c.genesis_public_key || "").slice(0, 12))}...${c.relay_url ? ` · Relay: ${escapeHtml(c.relay_url.replace(/^wss?:\/\//, ""))}` : ""}
    </div>
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Governance</div>
      <div style="font-size:11px;color:var(--text-dim);display:flex;flex-direction:column;gap:2px;">
        <span>Contribution: <b>${escapeHtml(gov.contribution || "open")}</b></span>
        <span>Validation: <b>${escapeHtml(gov.validation || "none")}</b></span>
        <span>Schema authority: <b>${escapeHtml(gov.schema_authority || "any_member")}</b></span>
        <span>Key rotation: <b>${escapeHtml(gov.key_rotation || "founder_only")}</b></span>
        <span>Fork policy: <b>${escapeHtml(gov.fork_policy || "allowed")}</b></span>
        <span>Join policy: <b>${escapeHtml(gov.join_policy || "open")}</b></span>
      </div>
    </div>

    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">TTL Settings</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <label style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="cd-ttl-enabled" ${gov.ttl_enabled ? "checked" : ""} /> Enabled</label>
        <select id="cd-ttl-base" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;width:80px;">
          ${[10080, 20160, 43200, 1440, 2880, 720].map(v => `<option value="${v}" ${(gov.ttl_base_mins || 10080) === v ? "selected" : ""}>${v / 60 < 24 ? v / 60 + "h" : Math.floor(v / 1440) + "d"}</option>`).join("")}
        </select>
        <span style="font-size:10px;color:var(--text-muted);">base</span>
      </div>
      <div style="display:flex;gap:8px;font-size:10px;color:var(--text-muted);margin-bottom:4px;">
        <span>Vote: ${gov.ttl_vote_mins || 360}min</span>
        <span>Min: ${gov.ttl_min_mins || 60}min</span>
        <span>Max: ${gov.ttl_max_mins || 43200}min</span>
      </div>
      <button id="cd-ttl-save" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save TTL</button>
    </div>` : ""}

    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Permissions</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--text-dim);">Anonymous posting:</span>
        <select id="cd-anon-posting" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
          <option value="forbidden" ${(gov.anonymous_posting || "forbidden") === "forbidden" ? "selected" : ""}>Forbidden</option>
          <option value="allowed" ${gov.anonymous_posting === "allowed" ? "selected" : ""}>Allowed</option>
          <option value="members_only" ${gov.anonymous_posting === "members_only" ? "selected" : ""}>Members only</option>
        </select>
        <button id="cd-anon-save" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save</button>
      </div>
    </div>` : ""}

    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Governance</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-dim);min-width:70px;">Join policy:</span>
          <select id="cd-join-policy" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="open" ${(gov.join_policy || "open") === "open" ? "selected" : ""}>Open</option>
            <option value="invite" ${gov.join_policy === "invite" ? "selected" : ""}>Founder Invite</option>
            <option value="token" ${gov.join_policy === "token" ? "selected" : ""}>Capability Token</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-dim);min-width:70px;">Contribution:</span>
          <select id="cd-contribution" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="open" ${(gov.contribution || "open") === "open" ? "selected" : ""}>Anyone</option>
            <option value="members_only" ${gov.contribution === "members_only" ? "selected" : ""}>Members Only</option>
          </select>
        </div>
        <div style="font-size:10px;color:var(--text-muted);">
          Open: anyone can write · Invite: founder adds pubkeys · Token: founder generates invite links
        </div>
      </div>
      <button id="cd-gov-save" style="margin-top:6px;padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save Governance</button>
    </div>` : ""}

    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Members (${c.members?.length || 0})</div>
      <div style="max-height:160px;overflow-y:auto;">${memberRows}</div>
      ${isFounder && (gov.join_policy || "open") === "invite" ? `
      <div style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px;display:flex;flex-direction:column;gap:4px;">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px;">Add Member</div>
        <input id="cd-add-pubkey" placeholder="Pubkey hex" style="padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
        <input id="cd-add-name" placeholder="Display name" style="padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
        <div style="display:flex;gap:6px;">
          <select id="cd-add-role" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="contributor">Contributor</option>
            <option value="maintainer">Maintainer</option>
            <option value="reader">Reader</option>
          </select>
          <button id="cd-add-member-btn" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Add</button>
        </div>
      </div>` : ""}
      ${isFounder && (gov.join_policy || "open") === "token" ? `
      <div style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px;display:flex;flex-direction:column;gap:4px;">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px;">Generate Invite Token</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="cd-token-role" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="contributor">Contributor</option>
            <option value="maintainer">Maintainer</option>
            <option value="reader">Reader</option>
          </select>
          <select id="cd-token-expiry" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="86400000">24h</option>
            <option value="604800000">7d</option>
            <option value="2592000000">30d</option>
            <option value="7776000000">90d</option>
            <option value="0">Never</option>
          </select>
          <select id="cd-token-uses" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="1">1 use</option>
            <option value="5">5 uses</option>
            <option value="10">10 uses</option>
            <option value="50">50 uses</option>
            <option value="0">Unlimited</option>
          </select>
        </div>
        <button id="cd-gen-token-btn" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Generate Token</button>
        <div id="cd-token-output" style="font-size:10px;color:var(--text-dim);margin-top:2px;word-break:break-all;"></div>
      </div>` : ""}
      ${memberRows && isFounder ? `
      <div style="margin-top:4px;font-size:10px;color:var(--text-muted);">Click × on a member row to remove them</div>` : ""}
    </div>
    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Relay</div>
      <div style="display:flex;gap:6px;align-items:center;">
        <select id="cd-relay-select" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
          <option value="">None</option>
          ${window._getSavedRelays?.()?.map(u => `<option value="${escapeHtml(u)}" ${u === (c.relay_url || "") ? "selected" : ""}>${escapeHtml(u)}</option>`).join("") || ""}
        </select>
        <button id="cd-relay-save" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save</button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">Pins sync from this relay. Change relay servers in ⚙ ICE settings.</div>
    </div>` : (c.relay_url ? `<div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;"><div style="font-weight:600;font-size:12px;margin-bottom:4px;">Relay</div><div style="font-size:11px;color:var(--text-dim);">${escapeHtml(c.relay_url)}</div></div>` : "")}
    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Access</div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${c.password_hash
          ? `<span style="font-size:11px;color:var(--text-dim);">🔒 Password protected</span><button id="cd-changepwd" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Change</button><button id="cd-removepwd" style="padding:4px 10px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">Remove</button>`
          : `<span style="font-size:11px;color:var(--text-dim);">Open access</span><button id="cd-setpwd" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">🔒 Set Password</button>`
        }
      </div>
    </div>` : (c.password_hash ? `<div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;"><div style="font-weight:600;font-size:12px;margin-bottom:4px;">Access</div><div style="font-size:11px;color:var(--text-dim);">🔒 Password protected</div></div>` : "")}
    ${c.bounds ? `<div style="font-size:11px;color:var(--text-dim);">Geographic bounds set</div>` : ""}
    <div style="margin-top:12px;display:flex;gap:8px;">
      ${isFounder ? `
        <select id="cd-visibility" style="flex:1;padding:6px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:4px;cursor:pointer;font-size:13px;">
          <option value="local" ${(c.visibility || "local") === "local" ? "selected" : ""}>Local Only</option>
          <option value="private" ${c.visibility === "private" ? "selected" : ""}>Private</option>
          <option value="unlisted" ${c.visibility === "unlisted" ? "selected" : ""}>Unlisted</option>
          <option value="public" ${c.visibility === "public" ? "selected" : ""}>Public</option>
        </select>
      ` : (c.visibility && c.visibility !== "local" ? `<span style="font-size:11px;color:var(--text-dim);">${c.visibility.charAt(0).toUpperCase() + c.visibility.slice(1)}</span>` : "")}
      <button id="cd-share-link" style="padding:8px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:4px;cursor:pointer;font-size:13px;">🔗 Share Link</button>
    </div>
    </div>
  </div>`;

  document.body.appendChild(ov);
  const clean = () => ov.remove();
  document.getElementById("cd-close").onclick = clean;
  ov.onclick = (e) => { if (e.target === ov) clean(); };

  const visSel = document.getElementById("cd-visibility");
  if (visSel) visSel.onchange = async () => {
    const newVis = visSel.value;
    const oldVis = c.visibility || "local";
    if (newVis === oldVis) return;
    if (newVis === "local" && oldVis !== "local") {
      const ok = await confirmDialog("Move this community back to local-only? It will be permanently deleted from the relay. Others will lose access.");
      if (!ok) { visSel.value = oldVis; return; }
    }
    if (oldVis === "local" && newVis !== "local") {
      const ok = await confirmDialog("Register this community on the relay? Your data will be uploaded so others can join via the share link. This cannot be fully undone.");
      if (!ok) { visSel.value = "local"; return; }
    }
    let bounds = c.bounds;
    if (!bounds && newVis !== "local") {
      const pins = await DB.getPins(c.community_id);
      if (pins.length > 0) {
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const p of pins) {
          try {
            const pin = decrypt_pin_data(p.ciphertext, p.nonce, state.dek);
            if (typeof pin.lat === "number" && typeof pin.lng === "number") {
              minLat = Math.min(minLat, pin.lat); maxLat = Math.max(maxLat, pin.lat);
              minLng = Math.min(minLng, pin.lng); maxLng = Math.max(maxLng, pin.lng);
            }
          } catch (_) {}
        }
        if (minLat !== Infinity) bounds = [minLat, minLng, maxLat, maxLng];
      }
    }
    c.visibility = newVis;
    await DB.saveCommunity({ ...c, visibility: newVis, bounds: bounds || c.bounds });
    state.currentCommunity = c;
    if (newVis !== "local") {
      window._relayPublishCommunity?.(c.community_id, newVis === "public");
    } else {
      window._relayDeleteCommunity?.(c.community_id);
      window._disconnectCommunity?.(c.community_id);
    }
    const labels = { local: "Local only", private: "Private", unlisted: "Unlisted", public: "Public" };
    toast("Visibility: " + (labels[newVis] || newVis), "#16a34a");
    clean();
    showCommunityDetails(c.community_id);
  };

  const setPwdBtn = document.getElementById("cd-setpwd");
  if (setPwdBtn) setPwdBtn.onclick = async () => {
    const pass = await promptSetPassword("Set community password");
    if (!pass) return;
    const hash = await hashCommunityPassword(pass, c.community_id);
    c.password_hash = hash;
    // Derive keypair from password — relay never sees secret_key
    const { generate_user_keypair_from_password, wrap_dek, unwrap_dek, encode_hex } = await import("./core/pkg/e2e_core.js");
    const kp = generate_user_keypair_from_password(pass, c.community_id);
    const team = await DB.getTeam(c.community_id);
    let dk;
    if (team && team.wrapped_dek && team.secret_key) {
      try { dk = unwrap_dek(team.wrapped_dek, team.secret_key); } catch (_) {}
    }
    if (!dk) dk = window._generate_dek();
    const newWrapped = wrap_dek(dk, encode_hex(kp.public));
    await DB.saveTeam({
      team_id: c.community_id, name: team?.name || c.name,
      public_key: encode_hex(kp.public), secret_key: encode_hex(kp.secret),
      wrapped_dek: newWrapped, key_derivation: "pbkdf2",
    });
    if (state.currentSet === c.community_id) state.dek = dk;
    await DB.saveCommunity(c);
    state.currentCommunity = c;
    if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
    toast("Password set", "#16a34a");
    clean();
    showCommunityDetails(c.community_id);
  };

  const changePwdBtn = document.getElementById("cd-changepwd");
  if (changePwdBtn) changePwdBtn.onclick = async () => {
    const pass = await promptSetPassword("Change community password");
    if (!pass) return;
    const hash = await hashCommunityPassword(pass, c.community_id);
    c.password_hash = hash;
    // Re-derive keypair from new password
    const { generate_user_keypair_from_password, wrap_dek, unwrap_dek, encode_hex } = await import("./core/pkg/e2e_core.js");
    const kp = generate_user_keypair_from_password(pass, c.community_id);
    const team = await DB.getTeam(c.community_id);
    let dk;
    if (team && team.wrapped_dek && team.secret_key) {
      try { dk = unwrap_dek(team.wrapped_dek, team.secret_key); } catch (_) {}
    }
    if (!dk) dk = window._generate_dek();
    const newWrapped = wrap_dek(dk, encode_hex(kp.public));
    await DB.saveTeam({
      team_id: c.community_id, name: team?.name || c.name,
      public_key: encode_hex(kp.public), secret_key: encode_hex(kp.secret),
      wrapped_dek: newWrapped, key_derivation: "pbkdf2",
    });
    if (state.currentSet === c.community_id) state.dek = dk;
    await DB.saveCommunity(c);
    state.currentCommunity = c;
    if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
    toast("Password changed", "#16a34a");
    clean();
    showCommunityDetails(c.community_id);
  };

  const removePwdBtn = document.getElementById("cd-removepwd");
  if (removePwdBtn) removePwdBtn.onclick = async () => {
    const ok = await confirmDialog("Remove password protection from this community?");
    if (!ok) return;
    c.password_hash = null;
    // Revert to random keypair (no longer password-derived)
    const team = await DB.getTeam(c.community_id);
    if (team && team.key_derivation === "pbkdf2") {
      const kp = window._generate_user_keypair();
      const dk = window._generate_dek();
      const newWrapped = window._wrap_dek(dk, window._encode_hex(kp.public));
      await DB.saveTeam({
        team_id: c.community_id, name: team?.name || c.name,
        public_key: window._encode_hex(kp.public), secret_key: window._encode_hex(kp.secret),
        wrapped_dek: newWrapped,
      });
      if (state.currentSet === c.community_id) state.dek = dk;
    }
    await DB.saveCommunity(c);
    state.currentCommunity = c;
    if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
    toast("Password removed", "#f97316");
    clean();
    showCommunityDetails(c.community_id);
  };

  const relaySaveBtn = document.getElementById("cd-relay-save");
  if (relaySaveBtn) relaySaveBtn.onclick = async () => {
    const select = document.getElementById("cd-relay-select");
    const newUrl = select?.value || null;
    c.relay_url = newUrl || null;
    await DB.saveCommunity(c);
    state.currentCommunity = c;
    if (newUrl) {
      const list = window._getSavedRelays?.() || [];
      if (!list.includes(newUrl)) { list.push(newUrl); import("./relay.js").then(r => r.saveRelayUrls(list)).catch(() => {}); }
      window._relayConnect?.(newUrl);
    }
    if (c.visibility && c.visibility !== "local" && newUrl) window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
    toast(newUrl ? "Relay updated" : "Relay removed", "#16a34a");
    clean();
    showCommunityDetails(c.community_id);
  };

  const ttlSaveBtn = document.getElementById("cd-ttl-save");
  if (ttlSaveBtn) ttlSaveBtn.onclick = async () => {
    gov.ttl_enabled = document.getElementById("cd-ttl-enabled")?.checked || false;
    gov.ttl_base_mins = parseInt(document.getElementById("cd-ttl-base")?.value) || 10080;
    c.governance = gov;
    await DB.saveCommunity(c);
    state.currentCommunity = c;
    if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
    toast("TTL settings saved", "#16a34a");
    clean();
    showCommunityDetails(c.community_id);
  };

  const anonSaveBtn = document.getElementById("cd-anon-save");
  if (anonSaveBtn) anonSaveBtn.onclick = async () => {
    gov.anonymous_posting = document.getElementById("cd-anon-posting")?.value || "forbidden";
    c.governance = gov;
    await DB.saveCommunity(c);
    state.currentCommunity = c;
    if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
    toast("Permissions saved", "#16a34a");
    clean();
    showCommunityDetails(c.community_id);
  };

  const shareBtn = document.getElementById("cd-share-link");
  if (shareBtn) shareBtn.onclick = () => {
    if (c.visibility === "local" || !c.visibility) {
      toast("Register the community on a relay before sharing (set visibility to Private or above)", "#f97316");
      return;
    }
    const nameBytes = new TextEncoder().encode(c.name || "");
    const cidBytes = hexToBytes(c.community_id.replace(/-/g, ""));
    const relayUrl = c.relay_url || (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",")[0]?.trim();
    const relayBytes = relayUrl ? new TextEncoder().encode(relayUrl) : new Uint8Array(0);
    const flags = c.password_hash ? 1 : 0;
    // Embed current map view as focus data
    const mapCenter = state.map?.getCenter();
    const mapZoom = state.map?.getZoom();
    const viewStr = mapCenter ? `${mapCenter.lat.toFixed(6)},${mapCenter.lng.toFixed(6)},${mapZoom || 5}` : "";
    const viewBytes = viewStr ? new TextEncoder().encode(viewStr) : new Uint8Array(0);
    const total = 1 + nameBytes.length + 16 + 1 + relayBytes.length + 1 + viewBytes.length;
    const buf = new Uint8Array(total);
    let pos = 0;
    buf[pos++] = nameBytes.length;
    buf.set(nameBytes, pos); pos += nameBytes.length;
    buf.set(cidBytes, pos); pos += 16;
    buf[pos++] = relayBytes.length;
    if (relayBytes.length > 0) buf.set(relayBytes, pos);
    pos += relayBytes.length;
    buf[pos++] = flags;
    if (viewBytes.length > 0) buf.set(viewBytes, pos);
    const b64 = btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const url = window.location.origin + window.location.pathname + "#community=" + b64;

    // Show QR + link modal
    const qrOv = document.createElement("div");
    qrOv.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2200;display:flex;align-items:center;justify-content:center;";
    qrOv.innerHTML = `<div style="background:white;padding:20px;border-radius:8px;max-width:340px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 4px;color:#111;font-size:15px;">🔗 Community Link</h3>
      <p style="font-size:10px;color:#666;margin:0 0 10px;">${escapeHtml(c.name || "").slice(0, 40)}</p>
      <div id="cm-qr-svg" style="margin-bottom:8px;display:flex;justify-content:center;"></div>
      <input id="cm-url" value="${escapeHtml(url)}" readonly style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;box-sizing:border-box;margin-bottom:8px;" onclick="this.select()" />
      <button id="cm-copy" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;margin-right:6px;">Copy Link</button>
      <button id="cm-close" style="padding:6px 14px;border:1px solid #ccc;background:white;border-radius:4px;cursor:pointer;font-size:13px;">Close</button>
    </div>`;
    document.body.appendChild(qrOv);
    document.getElementById("cm-close").onclick = () => qrOv.remove();
    qrOv.onclick = (e) => { if (e.target === qrOv) qrOv.remove(); };
    document.getElementById("cm-copy").onclick = () => {
      navigator.clipboard.writeText(url).then(() => toast("Link copied", "#16a34a")).catch(() => {});
    };
    import("./core/pkg/e2e_core.js").then(mod => {
      document.getElementById("cm-qr-svg").innerHTML = mod.generate_qr_svg(url) || "";
    }).catch(() => {});
  };

  // Generate invite token
  const genTokenBtn = document.getElementById("cd-gen-token-btn");
  if (genTokenBtn) genTokenBtn.onclick = async () => {
    const role = document.getElementById("cd-token-role")?.value || "contributor";
    const expiry = parseInt(document.getElementById("cd-token-expiry")?.value) || 0;
    const maxUses = parseInt(document.getElementById("cd-token-uses")?.value) || 1;
    const expTs = expiry > 0 ? Date.now() + expiry : 0;
    genTokenBtn.textContent = "Generating...";
    genTokenBtn.disabled = true;
    try {
      const relay = await import("./relay.js");
      const token = await relay.createInviteToken(c.community_id, role, expTs, maxUses);
      if (!token) { toast("Failed to create token", "#dc2626"); genTokenBtn.textContent = "Generate Token"; genTokenBtn.disabled = false; return; }
      // Build invite URL with is_invite flag
      const nameBytes = new TextEncoder().encode(c.name || "");
      const cidBytes = hexToBytes(c.community_id.replace(/-/g, ""));
      const relayUrl = c.relay_url || "";
      const relayBytes = relayUrl ? new TextEncoder().encode(relayUrl) : new Uint8Array(0);
      const roleBytes = new TextEncoder().encode(role);
      const expiryBuf = new Uint8Array(8);
      const dv = new DataView(expiryBuf.buffer);
      dv.setBigUint64(0, BigInt(expTs), false);
      const nonceBytes = hexToBytes(token.nonce.replace(/-/g, "").slice(0, 16)).slice(0, 8);
      const sigBytes = hexToBytes(token.signature);
      const flags = (c.password_hash ? 1 : 0) | (1 << 1);
      const total = 1 + nameBytes.length + 16 + 1 + relayBytes.length + 1 + 1 + roleBytes.length + 8 + 8 + 64;
      const buf = new Uint8Array(total);
      let pos = 0;
      buf[pos++] = nameBytes.length;
      buf.set(nameBytes, pos); pos += nameBytes.length;
      buf.set(cidBytes, pos); pos += 16;
      buf[pos++] = relayBytes.length;
      if (relayBytes.length > 0) buf.set(relayBytes, pos);
      pos += relayBytes.length;
      buf[pos++] = flags;
      buf[pos++] = roleBytes.length;
      buf.set(roleBytes, pos); pos += roleBytes.length;
      buf.set(expiryBuf, pos); pos += 8;
      buf.set(nonceBytes, pos); pos += 8;
      buf.set(sigBytes, pos);
      const b64 = btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const link = window.location.origin + window.location.pathname + "#community=" + b64;
      const output = document.getElementById("cd-token-output");
      if (output) output.innerHTML = `<a href="${escapeHtml(link)}" style="color:var(--accent);">Invite link</a><br><span style="font-size:9px;">Click to copy · ${role} · ${expiry > 0 ? Math.round(expiry / 3600000) + "h" : "never"} · ${maxUses > 0 ? maxUses + " uses" : "unlimited"}</span>`;
      await navigator.clipboard.writeText(link);
      toast("Invite link copied", "#16a34a");
    } catch (e) { toast("Failed to create token", "#dc2626"); }
    genTokenBtn.textContent = "Generate Token";
    genTokenBtn.disabled = false;
  };

  // Governance save
  const govSaveBtn = document.getElementById("cd-gov-save");
  if (govSaveBtn) govSaveBtn.onclick = async () => {
    gov.join_policy = document.getElementById("cd-join-policy")?.value || "open";
    gov.contribution = document.getElementById("cd-contribution")?.value || "open";
    c.governance = gov;
    await DB.saveCommunity(c);
    state.currentCommunity = c;
    if (c.visibility && c.visibility !== "local") {
      import("./relay.js").then(r => r.updateGovernance(c.community_id, gov)).catch(() => {});
    }
    toast("Governance saved", "#16a34a");
    clean();
    showCommunityDetails(c.community_id);
  };

  // Add member (Option A)
  const addMemberBtn = document.getElementById("cd-add-member-btn");
  if (addMemberBtn) addMemberBtn.onclick = async () => {
    const pubkey = document.getElementById("cd-add-pubkey")?.value?.trim();
    const name = document.getElementById("cd-add-name")?.value?.trim() || "Member";
    const role = document.getElementById("cd-add-role")?.value || "contributor";
    if (!pubkey) { toast("Enter the member's public key", "#f97316"); return; }
    try {
      const relay = await import("./relay.js");
      await relay.addMember(c.community_id, pubkey, name, role);
      toast("Member added", "#16a34a");
      await new Promise(r => setTimeout(r, 500));
      clean();
      showCommunityDetails(c.community_id);
    } catch (e) { toast("Failed to add member", "#dc2626"); }
  };

  // Remove member (× buttons)
  document.querySelectorAll(".cd-remove-btn").forEach(b => {
    b.onclick = async () => {
      const pubkey = b.dataset.pubkey;
      if (!pubkey) return;
      try {
        const relay = await import("./relay.js");
        await relay.removeMember(c.community_id, pubkey);
        toast("Member removed", "#f97316");
        await new Promise(r => setTimeout(r, 500));
        clean();
        showCommunityDetails(c.community_id);
      } catch (e) { toast("Failed to remove member", "#dc2626"); }
      };
    });

    // Show layers expand handler
    const listEl = ov.querySelector(".disc-layer-list")?.parentElement;
    if (listEl) {
      listEl.querySelectorAll(".disc-show-layers-btn").forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const cid = btn.dataset.communityId;
          const layerList = listEl.querySelector(`.disc-layer-list[data-community-id="${cid}"]`);
          if (!layerList) return;
          if (layerList.style.display === "block") {
            layerList.style.display = "none";
            btn.textContent = "Show Layers";
            return;
          }
          btn.textContent = "Loading...";
          btn.disabled = true;
          try {
            const layers = await window._relayListPublicLayers?.(cid) || [];
            if (layers.length === 0) {
              layerList.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:4px;">No public layers</div>';
            } else {
              layerList.innerHTML = layers.map(l => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
                  <span style="font-size:11px;">📑 ${escapeHtml(l.name)}</span>
                  <button class="disc-sub-btn" data-cid="${escapeHtml(cid)}" data-lid="${escapeHtml(l.layer_id)}" style="padding:3px 10px;border:none;background:#7c3aed;color:#fff;border-radius:3px;cursor:pointer;font-size:11px;">Subscribe</button>
                </div>
              `).join("");
              layerList.querySelectorAll(".disc-sub-btn").forEach(subBtn => {
                subBtn.onclick = async (ev) => {
                  ev.stopPropagation();
                  subBtn.textContent = "Subscribing...";
                  subBtn.disabled = true;
                  try {
                    const result = await window._relaySubscribeLayer?.(subBtn.dataset.cid, subBtn.dataset.lid);
                    if (result) {
                      subBtn.textContent = "Subscribed";
                      toast("Subscribed to layer", "#16a34a");
                    } else {
                      subBtn.textContent = "Failed";
                      subBtn.disabled = false;
                      toast("Subscription failed", "#dc2626");
                    }
                  } catch (_) {
                    subBtn.textContent = "Subscribe";
                    subBtn.disabled = false;
                  }
                };
              });
            }
            layerList.style.display = "block";
            btn.textContent = "Hide Layers";
          } catch (_) {
            btn.textContent = "Show Layers";
          }
          btn.disabled = false;
        };
      });
    }
  }

export async function createTutorial() {
  await createSet(t("tutorialMapName") || "Tutorial");

  const schemaDefs = [
    { schema_id: generate_uuid(), key: "heritage", name: "Heritage Site", fields: [
      { key:"year_built",label:"Year Built",type:"number" },
      { key:"status",label:"Status",type:"choice",options:["Standing","Ruins","Reconstructed","At Risk"] },
      { key:"century",label:"Century",type:"choice",options:["Ancient","Medieval","Renaissance","Industrial","Modern"] },
      { key:"unesco",label:"UNESCO",type:"boolean" }
    ]},
    { schema_id: generate_uuid(), key: "natural", name: "Natural Feature", fields: [
      { key:"feature_type",label:"Type",type:"choice",options:["Mountain","Waterfall","Forest","Reef","Canyon","Glacier","Desert"] },
      { key:"elevation_m",label:"Elevation (m)",type:"number" },
      { key:"protected",label:"Protected",type:"boolean" },
      { key:"best_season",label:"Best Season",type:"choice",options:["Spring","Summer","Autumn","Winter","Year-round"] }
    ]},
    { schema_id: generate_uuid(), key: "city", name: "City Note", fields: [
      { key:"observation_type",label:"Type",type:"choice",options:["Architecture","Food","Transport","Market","Nightlife"] },
      { key:"rating",label:"Rating",type:"number" },
      { key:"visited",label:"Visited",type:"date" },
      { key:"recommend",label:"Recommend",type:"boolean" }
    ]},
    { schema_id: generate_uuid(), key: "festival", name: "Festival", fields: [
      { key:"month",label:"Month",type:"choice",options:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] },
      { key:"duration_days",label:"Duration (days)",type:"number" },
      { key:"attendance",label:"Attendance",type:"number" },
      { key:"free_entry",label:"Free Entry",type:"boolean" }
    ]},
  ];
  const schemaMap = {};
  for (const sd of schemaDefs) { schemaMap[sd.key] = sd.schema_id; await DB.saveSchema({ schema_id: sd.schema_id, name: sd.name, fields: sd.fields }); }
  state.schemas = await DB.getSchemas();

  const layerDefs = [
    { name: "Tutorial", color: "#7c3aed", opacity: 1.0, default_schema_id: null },
    { name: "Why This Matters", color: "#ef4444", opacity: 1.0, default_schema_id: null },
    { name: "Heritage", color: "#eab308", opacity: 0.85, default_schema_id: schemaMap.heritage },
    { name: "Nature", color: "#16a34a", opacity: 0.8, default_schema_id: schemaMap.natural },
    { name: "Urban", color: "#2563eb", opacity: 0.7, default_schema_id: schemaMap.city },
    { name: "Festivals", color: "#ec4899", opacity: 0.6, default_schema_id: schemaMap.festival },
  ];
  const layerMap = {};
  for (const ld of layerDefs) {
    const lid = generate_uuid();
    layerMap[ld.name] = lid;
    state.layers.push({ layer_id: lid, name: ld.name, color: ld.color, visible: true, opacity: ld.opacity, default_schema_id: ld.default_schema_id });
  }
  await DB.saveLayers(state.currentSet, state.layers);

  const pids = [];
  for (const tp of TUTORIAL_PINS) {
    const pid = generate_uuid();
    const enc = encrypt_pin_data(
      tp.title,
      tp.note,
      tp.lat,
      tp.lng,
      tp.color,
      state.dek,
    );
    const pin = {
      pin_id: pid,
      team_id: state.currentSet,
      layer_id: layerMap[tp.layer] || null,
      ciphertext: enc.ciphertext,
      nonce: enc.nonce,
      created_at: Date.now(),
    };
    if (tp.schema) pin.schema_id = schemaMap[tp.schema] || tp.schema;
    if (tp.emoji) pin.emoji = tp.emoji;
    if (tp.tf !== undefined && tp.tf !== null) pin.valid_from = tp.tf;
    if (tp.tt !== undefined && tp.tt !== null) pin.valid_until = tp.tt;
    if (tp.custom) {
      const cdEnc = encrypt_raw_bytes(new TextEncoder().encode(JSON.stringify(tp.custom)), state.dek);
      pin.custom_data = { ciphertext: cdEnc.ciphertext, nonce: cdEnc.nonce };
    }
    if (!tp.posted_anonymously && state.signingPublicKey) pin.author_pubkey = state.signingPublicKey;
    await DB.savePin(pin);
    pids.push(pid);
  }
  await loadPins();
  window._tutorialPids = pids;
  await saveSlideOrder(pids);
  window._addHistory?.(
    t("tutorialLoaded") || "Tutorial loaded",
    `${TUTORIAL_PINS.length} ${t("featurePins") || "feature pins"}`,
  );
  window._renderUI?.();
  setTimeout(() => startSlideshow(pids), 700);
}

export function startSlideshow(pinIds, opts = {}) {
  const map = state.map;
  if (!map || !pinIds || pinIds.length === 0) return;

  const { autoPlay = false, speed = 5000, loop = false, startAt = 0 } = opts;
  let current = 0;
  const total = pinIds.length;
  let currentOrder = pinIds;
  let timer = null;
  let playing = false;
  let fullscreen = false;
  let currentAudio = null;
  const savedDrawer = window._drawerActive;
  const savedTopBar = document.getElementById("top-bar")?.classList.contains("hidden");

  const ctrl = document.getElementById("slideshow-bar");
  if (ctrl) ctrl.remove();
  const bar = document.createElement("div");
  bar.id = "slideshow-bar";
  bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:2000;background:var(--bg-card);border-top:1px solid var(--border);box-shadow:0 -2px 14px rgba(0,0,0,0.18);font-size:13px;display:flex;flex-direction:column;max-height:52vh;transition:max-height 0.3s;";

  const card = document.createElement("div");
  card.id = "slideshow-card";
  card.style.cssText = "padding:12px 16px;overflow-y:auto;flex:1;min-height:40px;";
  bar.appendChild(card);

  const ctrlRow = document.createElement("div");
  ctrlRow.id = "slideshow-controls";
  ctrlRow.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 16px;border-top:1px solid var(--border-light);flex-wrap:wrap;justify-content:center;position:relative;";
  bar.appendChild(ctrlRow);

  function stopAudio() {
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      if (current < total - 1) {
        goTo(current + 1, true);
      } else if (loop) {
        goTo(0, true);
      } else {
        stopTimer(); playing = false; renderControls();
      }
    }, speed);
  }

  function togglePlay() {
    if (playing) { stopTimer(); playing = false; }
    else { playing = true; startTimer(); }
    renderControls();
  }

  function toggleFullscreen() {
    fullscreen = !fullscreen;
    const container = map.getContainer();
    if (fullscreen) {
      container.classList.add("slideshow-fullscreen");
      window._drawerActive = false;
      document.getElementById("top-bar")?.classList.add("hidden");
    } else {
      container.classList.remove("slideshow-fullscreen");
      window._drawerActive = savedDrawer;
      if (!savedTopBar) document.getElementById("top-bar")?.classList.remove("hidden");
    }
    window._renderUI?.();
  }

  async function onReorder(newOrder) {
    currentOrder = newOrder;
    window._slideOrder = newOrder;
    await saveSlideOrder(newOrder);
    goTo(current);
  }

  function cleanup() {
    stopTimer();
    stopAudio();
    playing = false;
    if (fullscreen) { fullscreen = false; map.getContainer().classList.remove("slideshow-fullscreen"); window._drawerActive = savedDrawer; if (!savedTopBar) document.getElementById("top-bar")?.classList.remove("hidden"); window._renderUI?.(); }
    window._slideshowActive = false;
    window._slideshowGoTo = null;
    window._slideshowTogglePlay = null;
    window._slideshowExit = null;
    bar.remove();
  }

  function renderCard() {
    const pid = currentOrder[current];
    const marker = state._markerMap?.get(pid);
    if (!marker) { card.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px;">Slide ${current + 1} unavailable</div>`; return; }

    const pinData = marker._pinData || {};
    const title = pinData.title || marker._pinTitle || `Pin ${current + 1}`;
    const note = pinData.note || "";
    const emoji = marker._pinEmoji || "";
    const color = marker._pinColor || "#2563eb";
    const trust = computePinTrust(pinData, state.signingPublicKey) ?? 0;
    const trustColor = trust >= 2 ? "#16a34a" : trust >= 0.5 ? "#65a30d" : trust >= -0.5 ? "#9ca3af" : trust >= -2 ? "#f97316" : "#dc2626";
    const attestations = pinData.attestations || [];
    const up = attestations.filter(a => a.type === "confirmed").length;
    const down = attestations.filter(a => a.type === "disputed").length + attestations.filter(a => a.type === "flagged").length;

    let mediaHtml = "";
    const r = marker._media;
    if (r && state.dek) {
      try {
        const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
          const mt = r.type || "";
          const blob = new Blob([dec], { type: mt });
          const url = URL.createObjectURL(blob);
          if (mt.startsWith("image/")) mediaHtml = `<img src="${url}" style="max-width:100%;max-height:30vh;border-radius:6px;margin-top:8px;">`;
          else if (mt.startsWith("video/")) mediaHtml = `<video src="${url}" controls style="max-width:100%;max-height:30vh;border-radius:6px;margin-top:8px;"></video>`;
          else if (mt.startsWith("audio/")) mediaHtml = `<audio src="${url}" controls style="width:100%;margin-top:8px;" class="slideshow-audio"></audio>`;
      } catch (_) {}
    }

    let ttlHtml = "";
    if (marker._ttlExpiresAt) {
      const remaining = marker._ttlExpiresAt - Date.now();
      if (remaining > 0) {
        const mins = Math.ceil(remaining / 60000);
        ttlHtml = `<span style="color:var(--text-dim);">⏳ ${mins}m</span>`;
      } else {
        ttlHtml = `<span style="color:#dc2626;">⏳ Expired</span>`;
      }
    }

    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="width:4px;min-height:24px;background:${color};border-radius:2px;flex-shrink:0;align-self:stretch;"></div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
            <h3 style="margin:0;font-size:16px;">${escapeHtml(title)}</h3>
            ${emoji ? `<span style="font-size:20px;">${emoji}</span>` : ""}
            <span style="font-size:10px;color:${trustColor};border:1px solid ${trustColor};border-radius:3px;padding:1px 5px;">${trust >= 2 ? "Trusted" : trust >= 0.5 ? "Neutral" : trust >= -0.5 ? "Low" : "Disputed"}</span>
            ${ttlHtml}
          </div>
          ${note ? `<div style="color:var(--text);font-size:14px;line-height:1.5;white-space:pre-wrap;margin-bottom:8px;">${escapeHtml(note)}</div>` : ""}
          ${mediaHtml}
          <div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:11px;color:var(--text-dim);">
            <span>✅ ${up}</span><span>⚠️ ${down}</span>
            ${marker._authorPubkey ? `<span style="color:var(--text-muted);">by ${escapeHtml(String(marker._authorPubkey).slice(0, 8))}</span>` : ""}
          </div>
        </div>
      </div>`;

    // Auto-play audio if present
    stopAudio();
    const audioEl = card.querySelector(".slideshow-audio");
    if (audioEl && playing) {
      currentAudio = audioEl;
      audioEl.play().catch(() => {});
    }
  }

  function renderControls() {
    const WINDOW = 7; // max visible dots
    let dots = "";
    const dotStyle = (i) => `display:inline-block;width:8px;height:8px;border-radius:50%;background:${i === current ? "#2563eb" : "var(--border)"};cursor:pointer;margin:0 2px;flex-shrink:0;transition:background 0.15s;`;

    if (total <= WINDOW) {
      for (let i = 0; i < total; i++) {
        dots += `<span data-slide="${i}" style="${dotStyle(i)}"></span>`;
      }
    } else {
      const half = Math.floor(WINDOW / 2);
      let start = Math.max(0, current - half);
      let end = start + WINDOW;
      if (end > total) { end = total; start = end - WINDOW; }

      if (start > 0) {
        dots += `<span data-jump="${start - 1}" style="display:inline-block;width:8px;height:8px;line-height:8px;text-align:center;color:var(--text-dim);cursor:pointer;font-size:11px;margin:0 1px;flex-shrink:0;">…</span>`;
      }
      for (let i = start; i < end; i++) {
        dots += `<span data-slide="${i}" style="${dotStyle(i)}"></span>`;
      }
      if (end < total) {
        dots += `<span data-jump="${end}" style="display:inline-block;width:8px;height:8px;line-height:8px;text-align:center;color:var(--text-dim);cursor:pointer;font-size:11px;margin:0 1px;flex-shrink:0;">…</span>`;
      }
    }
    const speedLabel = speed >= 8000 ? "Slow" : speed <= 3000 ? "Fast" : "Normal";
    ctrlRow.innerHTML = `
      <div id="slideshow-dots" style="display:flex;align-items:center;gap:0;">${dots}</div>
      <span style="color:var(--text-dim);font-size:11px;margin:0 2px;">${current + 1}/${total}</span>
      <button id="tour-list" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:11px;color:var(--text-dim);" title="All slides">☰ Pin list</button>
      <button id="tour-prev" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:12px;">←</button>
      <button id="tour-play" style="padding:4px 12px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:14px;min-width:32px;">${playing ? "⏸" : "▶"}</button>
      <button id="tour-next" style="padding:4px 12px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:12px;">${current === total - 1 ? (t("finish") || "Finish") : (t("next") || "Next →")}</button>
      <button id="tour-speed" style="padding:4px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:10px;color:var(--text-dim);" title="Speed: ${speedLabel}">${speedLabel}</button>
      <button id="tour-loop" style="padding:4px 6px;border:1px solid var(--border);background:${loop ? "#2563eb" : "var(--bg-input)"};color:${loop ? "white" : "var(--text-dim)"};border-radius:4px;cursor:pointer;font-size:12px;" title="${loop ? "Looping" : "Loop off"}">🔁</button>
      <button id="tour-fullscreen" style="padding:4px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-dim);" title="Fullscreen">${fullscreen ? "⛶" : "⛶"}</button>
      <button id="tour-edit" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:11px;color:var(--text-dim);">${t("edit") || "Edit"}</button>
      <button id="tour-exit" style="padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:4px;cursor:pointer;font-size:11px;">✕</button>
    `;

    ctrlRow.querySelector("#tour-prev").onclick = () => { playing = false; stopTimer(); goTo(current - 1); renderControls(); };
    ctrlRow.querySelector("#tour-play").onclick = () => togglePlay();
    ctrlRow.querySelector("#tour-next").onclick = () => {
      if (current < total - 1) { playing = false; stopTimer(); goTo(current + 1); renderControls(); }
      else cleanup();
    };
    ctrlRow.querySelector("#tour-speed").onclick = () => {
      const speeds = [2000, 5000, 8000];
      const idx = speeds.indexOf(speed);
      const newSpeed = speeds[(idx + 1) % speeds.length];
      cleanup(); startSlideshow(currentOrder, { autoPlay: playing, speed: newSpeed, loop, startAt: current });
    };
    ctrlRow.querySelector("#tour-loop").onclick = () => {
      const newLoop = !loop;
      cleanup(); startSlideshow(currentOrder, { autoPlay: playing, speed, loop: newLoop, startAt: current });
      return;
    };
    ctrlRow.querySelector("#tour-fullscreen").onclick = () => toggleFullscreen();
    ctrlRow.querySelector("#tour-edit").onclick = () => editSlideOrder(currentOrder, current, onReorder);
    ctrlRow.querySelector("#tour-exit").onclick = cleanup;

    ctrlRow.querySelectorAll("#slideshow-dots [data-slide]").forEach(dot => {
      dot.onclick = () => { playing = false; stopTimer(); goTo(parseInt(dot.dataset.slide)); renderControls(); };
    });
    ctrlRow.querySelectorAll("#slideshow-dots [data-jump]").forEach(dot => {
      dot.onclick = () => { playing = false; stopTimer(); goTo(parseInt(dot.dataset.jump)); renderControls(); };
    });

    // Quick-nav popout triggered by ☰ button
    let quickNav = null;

    function buildQuickNav() {
      if (!quickNav || !document.body.contains(quickNav)) {
        quickNav = document.createElement("div");
        quickNav.id = "slideshow-quicknav";
        quickNav.style.cssText = "position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--border);border-radius:6px;box-shadow:0 2px 16px rgba(0,0,0,0.15);max-height:260px;overflow-y:auto;min-width:200px;z-index:2001;display:none;font-size:12px;";
      }
      const rows = [];
      for (let i = 0; i < total; i++) {
        const pid = currentOrder[i];
        const m = state._markerMap?.get(pid);
        const t = escapeHtml((m?._pinTitle || `Pin ${i + 1}`).slice(0, 40));
        const active = i === current;
        rows.push(`<div data-sld="${i}" style="display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;${active ? "background:#2563eb;color:#fff;" : "color:var(--text);"}border-bottom:1px solid var(--border-light);font-size:12px;white-space:nowrap;">
          <span style="font-weight:600;min-width:22px;text-align:right;">${i + 1}.</span>
          <span style="overflow:hidden;text-overflow:ellipsis;">${t}</span>
          ${active ? '<span style="margin-left:auto;font-size:10px;">●</span>' : ""}
        </div>`);
      }
      quickNav.innerHTML = rows.join("");
      quickNav.querySelectorAll("[data-sld]").forEach(row => {
        row.onclick = () => {
          playing = false; stopTimer();
          goTo(parseInt(row.dataset.sld));
          renderControls();
          closeQuickNav();
        };
        row.onmouseenter = () => { row.style.background = row.dataset.sld === String(current) ? "#2563eb" : "var(--bg-input)"; };
        row.onmouseleave = () => { row.style.background = row.dataset.sld === String(current) ? "#2563eb" : ""; };
      });
      const curRow = quickNav.querySelector(`[data-sld="${current}"]`);
      if (curRow) curRow.scrollIntoView({ block: "nearest" });
    }

    function showQuickNav() {
      buildQuickNav();
      if (!ctrlRow.contains(quickNav)) ctrlRow.appendChild(quickNav);
      quickNav.style.display = "block";
    }

    function closeQuickNav() {
      if (quickNav) quickNav.style.display = "none";
    }

    const quickBtn = ctrlRow.querySelector("#tour-list");
    quickBtn.onclick = (e) => {
      e.stopPropagation();
      if (quickNav && quickNav.style.display === "block") { closeQuickNav(); }
      else showQuickNav();
    };
    // Close on click outside
    if (ctrlRow._quickNavDoc) document.removeEventListener("click", ctrlRow._quickNavDoc);
    const docClick = (e) => {
      if (quickNav && quickNav.style.display === "block" && !quickNav.contains(e.target) && e.target !== quickBtn) {
        closeQuickNav();
      }
    };
    ctrlRow._quickNavDoc = docClick;
    document.addEventListener("click", docClick);
  }

  function goTo(i, auto = false) {
    if (!auto) { playing = false; stopTimer(); }
    else { stopAudio(); }
    current = Math.max(0, Math.min(total - 1, i));
    window._slideshowCurrent = current;
    const pid = currentOrder[current];
    const marker = state._markerMap?.get(pid);
    if (marker) {
      map.flyTo(marker.getLatLng(), marker._pinZoom || 13, { duration: 1.2 });
    }
    renderCard();
    renderControls();
  }

  // Register global handlers for keyboard access
  window._slideshowActive = true;
  window._slideshowCurrent = 0;
  window._slideshowGoTo = (i) => { goTo(i); };
  window._slideshowTogglePlay = () => togglePlay();
  window._slideshowToggleFullscreen = () => toggleFullscreen();
  window._slideshowExit = () => cleanup();

  document.body.appendChild(bar);
  goTo(startAt);
  if (autoPlay) { playing = true; startTimer(); renderControls(); }
}

async function saveSlideOrder(order) {
  if (!state.currentSet || !Array.isArray(order)) return;
  const s = await DB.getSettings(state.currentSet);
  const settings = s || { map_center: [0, 0], map_zoom: 5 };
  settings.slide_order = order;
  await DB.saveSettings(state.currentSet, settings);
}

export async function startCurrentMapSlideshow() {
  const markerMap = state._markerMap;
  if (!markerMap || markerMap.size === 0) return;
  const settings = await DB.getSettings(state.currentSet);
  let pinIds;
  if (
    settings &&
    Array.isArray(settings.slide_order) &&
    settings.slide_order.length > 0
  ) {
    const existing = new Set([...markerMap.keys()]);
    pinIds = settings.slide_order.filter((id) => existing.has(id));
    for (const id of existing) {
      if (!pinIds.includes(id)) pinIds.push(id);
    }
  } else {
    pinIds = [...markerMap.keys()].sort((a, b) => {
      const ca = markerMap.get(a)?._createdAt || 0;
      const cb = markerMap.get(b)?._createdAt || 0;
      if (ca !== cb) return ca - cb;
      const ta = markerMap.get(a)?._pinTitle || "";
      const tb = markerMap.get(b)?._pinTitle || "";
      return ta.localeCompare(tb);
    });
  }
  startSlideshow(pinIds);
}

function editSlideOrder(pinIds, currentIndex, onSave) {
  const markerMap = state._markerMap;
  let order = [...pinIds];

  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
  ov.onclick = (e) => {
    if (e.target === ov) ov.remove();
  };

  function renderList() {
    const rows = order
      .map((pid, i) => {
        const marker = markerMap?.get(pid);
        const title = escapeHtml(marker?._pinTitle || `Pin ${i + 1}`);
        const upDisabled = i === 0 ? "opacity:0.3;cursor:default;" : "";
        const downDisabled =
          i === order.length - 1 ? "opacity:0.3;cursor:default;" : "";
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border-light);">
        <span style="flex:1;font-size:13px;">${i + 1}. ${title}</span>
        <button class="reorder-up" data-i="${i}" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;${upDisabled}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="reorder-down" data-i="${i}" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;${downDisabled}" ${i === order.length - 1 ? "disabled" : ""}>▼</button>
      </div>`;
      })
      .join("");

    listEl.innerHTML = rows;

    listEl.querySelectorAll(".reorder-up").forEach((btn) => {
      btn.onclick = (e) => {
        const i = parseInt(btn.dataset.i);
        if (i > 0) {
          [order[i], order[i - 1]] = [order[i - 1], order[i]];
          renderList();
        }
      };
    });

    listEl.querySelectorAll(".reorder-down").forEach((btn) => {
      btn.onclick = (e) => {
        const i = parseInt(btn.dataset.i);
        if (i < order.length - 1) {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
          renderList();
        }
      };
    });
  }

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:420px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:70vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">${t("editSlideOrder") || "Edit Slide Order"}</h3>
      <button id="reorder-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div id="reorder-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;max-height:50vh;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button id="reorder-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;">${t("cancel")}</button>
      <button id="reorder-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button>
    </div>
  </div>`;

  document.body.appendChild(ov);
  const listEl = document.getElementById("reorder-list");
  document.getElementById("reorder-close").onclick = () => ov.remove();
  document.getElementById("reorder-cancel").onclick = () => ov.remove();
  document.getElementById("reorder-save").onclick = () => {
    onSave([...order]);
    ov.remove();
  };
  renderList();
}

export async function deleteSet(sid, skipConfirm = false) {
  if (!skipConfirm && !(await confirmDialog(t("deleteSetConfirm")))) return;
  const c = await DB.getCommunity(sid);
  if (c && c.visibility && c.visibility !== "local") {
    const isFounder = (c.members || []).some(m => m.pubkey === state.signingPublicKey && m.role === "founder");
    if (isFounder) {
      toast("Open community details (ℹ) and set visibility to Local to remove from relay first", "#f97316");
      return;
    }
  }
  await DB.deleteTeam(sid);
  delete window._names[sid];
  if (state.currentSet === sid) {
    const ids = Object.keys(window._names || {});
    state.currentSet = ids[0] || null;
    if (state.currentSet) await switchSet(state.currentSet);
    else await createSet("Default");
  }
  await loadSetList();
  window._renderUI?.();
}

export async function renameSet(sid, newName) {
  await DB.renameTeam(sid, newName);
  window._names[sid] = newName;
  window._renderUI?.();
}

export function showSetsModal() {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";

  async function renderList() {
    const ids = Object.keys(window._names || {});
    if (state.currentSet && !ids.includes(state.currentSet))
      ids.push(state.currentSet);

    const communities = await Promise.all(ids.map(id => DB.getCommunity(id).catch(() => null)));

    const rows = ids
      .map((id, i) => {
        const nm = escapeHtml((window._names[id] || id).slice(0, 30));
        const isActive = id === state.currentSet;
        const hasPeers = [...state.peers.values()].some(
          (p) => p.setId === id && !p.offline,
        );
        const dot = hasPeers
          ? '<span style="color:#16a34a;font-size:10px;">●</span>'
          : "";
        const isTutorial = nm === "Tutorial" && window._tutorialPids?.length;
        const replayBtn = isTutorial
          ? `<button class="set-replay-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;margin-right:4px;flex-shrink:0;" title="${t("replayTour") || "Replay Tour"}">▶</button>`
          : "";
        const community = communities[i];
        const memberCount = community ? (community.members?.length || 1) : 1;
        const pubBadge = community?.visibility && community.visibility !== "local"
          ? `<span style="background:#059669;color:#fff;font-size:9px;padding:0 4px;border-radius:2px;margin-left:4px;">${community.visibility}</span>`
          : "";
        const info = community
          ? `<span style="font-size:10px;color:var(--text-dim);">${memberCount} member${memberCount !== 1 ? "s" : ""}${pubBadge}</span>`
          : "";
        return `<div class="set-row" data-sid="${escapeHtml(id)}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #e5e7eb;cursor:pointer;${isActive ? "background:#eff6ff;" : ""}">
        <div style="flex:1;display:flex;flex-direction:column;">
          <span class="set-name-display" style="font-size:14px;${isActive ? "font-weight:600;color:#2563eb;" : ""}">${nm} ${dot}</span>
          ${info}
        </div>
        <button class="set-detail-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;flex-shrink:0;color:var(--text-dim);" title="Community details">ℹ</button>
        <button class="set-slideshow-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;margin-right:4px;flex-shrink:0;" title="${t("slideshow") || "Slideshow"}">▶</button>
        ${replayBtn}
        <button class="set-rename-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid #9ca3af;background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;flex-shrink:0;">✎</button>
        <button class="set-delete-btn" data-sid="${escapeHtml(id)}" style="padding:2px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">×</button>
      </div>`;
      })
      .join("");

    listEl.innerHTML =
      rows ||
      '<div style="padding:12px;color:#9ca3af;text-align:center;">No saved maps</div>';

    listEl.querySelectorAll(".set-detail-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showCommunityDetails(btn.dataset.sid);
      };
    });

    listEl.querySelectorAll(".set-row").forEach((row) => {
      row.onclick = async (e) => {
        if (e.target.closest("button")) return;
        const sid = row.dataset.sid;
        if (sid === state.currentSet) return;
        const clean = () => ov.remove();
        clean();
        await switchSet(sid);
      };
    });

    listEl.querySelectorAll(".set-rename-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sid;
        const nameSpan = btn.parentElement.querySelector(".set-name-display");
        const currentName = window._names[sid] || "";
        nameSpan.innerHTML = `<input type="text" class="rename-input" value="${escapeHtml(currentName)}" style="width:100%;padding:4px;border:1px solid #2563eb;border-radius:3px;font-size:14px;box-sizing:border-box;" />`;
        const input = nameSpan.querySelector(".rename-input");
        input.focus();
        input.select();

        const doRename = async () => {
          const newName = input.value.trim();
          if (newName && newName !== currentName) {
            await renameSet(sid, newName);
          }
          renderList();
        };

        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") doRename();
          if (ev.key === "Escape") renderList();
        });

        input.addEventListener("blur", () => {
          setTimeout(() => {
            if (document.body.contains(input)) renderList();
          }, 150);
        });
      };
    });

    listEl.querySelectorAll(".set-slideshow-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sid;
        if (sid !== state.currentSet) await switchSet(sid);
        ov.remove();
        setTimeout(() => startCurrentMapSlideshow(), 300);
      };
    });

    listEl.querySelectorAll(".set-replay-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sid;
        if (sid !== state.currentSet) await switchSet(sid);
        ov.remove();
        setTimeout(() => startSlideshow(window._tutorialPids), 300);
      };
    });

    listEl.querySelectorAll(".set-delete-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sid;
        const name = window._names[sid] || sid;
        if (!(await confirmDialog(t("deleteMapConfirm", { name })))) return;
        await deleteSet(sid, true);
        if (Object.keys(window._names || {}).length === 0) {
          ov.remove();
        } else {
          renderList();
        }
      };
    });
  }

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:400px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">${t("savedMaps")}</h3>
      <button id="sets-modal-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div id="sets-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;"></div>
    <button id="sets-modal-new" style="margin-top:12px;width:100%;padding:8px;border:1px dashed #9ca3af;background:transparent;color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:14px;">${t("newMap")}</button>
    <button id="sets-modal-tutorial" style="margin-top:8px;width:100%;padding:8px;border:1px dashed #2563eb;background:transparent;color:#2563eb;border-radius:4px;cursor:pointer;font-size:14px;">${t("tutorialMapName") || "Tutorial"}</button>
  </div>`;

  document.body.appendChild(ov);

  const listEl = document.getElementById("sets-list");

  const cleanFn = () => ov.remove();
  document.getElementById("sets-modal-close").onclick = cleanFn;
  ov.onclick = (e) => {
    if (e.target === ov) cleanFn();
  };
  document.getElementById("sets-modal-new").onclick = async () => {
    const n = prompt(t("newMapPrompt"))?.trim();
    if (n) {
      await createSet(n);
      if (!document.body.contains(ov)) return;
      renderList();
    }
  };
  document.getElementById("sets-modal-tutorial").onclick = async () => {
    cleanFn();
    await createTutorial();
  };

  renderList();
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export async function loadPins() {
  if (!state.dek || !state.currentSet) return;
  if (state._loadPinsBusy) {
    state._pinsNeedReload = true;
    return;
  }
  state._loadPinsBusy = true;
  const container = state.map?.getContainer();
  if (container) container.classList.add("pins-loading");
  try {
  if (state.layers.length === 0) await loadLayersForSet(state.currentSet);

  state.markers.length = 0;
  state.pinSearchText.length = 0;
  const markerMap = state._markerMap || (state._markerMap = new Map());
  const keepIds = new Set();
  const layerMap = new Map(state.layers.map(l => [l.layer_id, l]));
  const defaultLayer = state.layers[0];

  for (const row of await DB.getPins(state.currentSet)) {
    try {
      state._decryptedPinCache = state._decryptedPinCache || new Map();
      const cached = state._decryptedPinCache.get(row.pin_id);
      let pin;
      if (cached && cached.ciphertext === row.ciphertext) {
        pin = cached.pin;
      } else {
        pin = decrypt_pin_data(row.ciphertext, row.nonce, state.dek);
        state._decryptedPinCache.set(row.pin_id, { pin, ciphertext: row.ciphertext });
        if (state._decryptedPinCache.size > 500) {
          const firstKey = state._decryptedPinCache.keys().next().value;
          if (firstKey) state._decryptedPinCache.delete(firstKey);
        }
      }
      pin.pin_id = row.pin_id;
      pin.attestations = row.attestations;
      const gov = {
        ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360,
        ttl_min_mins: 60, ttl_max_mins: 43200, anonymous_posting: "forbidden",
        ...(state.currentCommunity?.governance || {}),
      };
    if (gov.ttl_enabled && row.ttl_expires_at && row.ttl_expires_at < Date.now()) {
      await DB.deletePin(row.pin_id);
      window._broadcast?.("delete_pin", { pin_id: row.pin_id });
      continue;
    }
      const tidx = window._tutorialPids?.indexOf(row.pin_id);
      if (tidx !== -1 && tidx !== undefined) {
        const tpin = getTutorialPin(tidx);
        if (tpin) { pin.title = tpin.title; pin.note = tpin.note; }
      }
      keepIds.add(row.pin_id);
      const layerId = row.layer_id || (defaultLayer ? defaultLayer.layer_id : null);
      const layer = layerId ? layerMap.get(layerId) : defaultLayer;
      const opacity = layer && layer.visible ? layer.opacity : 0;
      const layerName = layer ? layer.name : "";
      const layerColor = layer ? layer.color : "#7c3aed";

      let m = markerMap.get(row.pin_id);
      if (!m) {
        m = L.marker([pin.lat, pin.lng], {
          icon: pinIcon(pin.color || "#2563eb", row.emoji),
          opacity,
        });
        m._pinId = row.pin_id;
        m._pinColor = pin.color || "#2563eb";
        m._pinTitle = pin.title || "";
        m._pinEmoji = row.emoji;
        m._createdAt = row.created_at || 0;
        m._authorPubkey = row.author_pubkey || null;
        m._pinZoom = row.map_zoom || 13;
        m._media = row.media;
        m._pinData = pin;
        m._layerId = layerId;
        m._layerName = layerName;
        m._layerColor = layerColor;
        m._validFrom = row.valid_from !== undefined ? row.valid_from : null;
        m._validTo = row.valid_until !== undefined ? row.valid_until : null;
        m._ttlExpiresAt = row.ttl_expires_at || null;
        m._ttlVoteUp = row.vote_count_up || 0;
        m._ttlVoteDown = row.vote_count_down || 0;
        m._postedAnonymously = row.posted_anonymously || false;
        m._customData = row.custom_data;
        m._schemaId = row.schema_id;
        if (row.posted_anonymously) {
          m.setOpacity(Math.max(opacity * 0.7, 0.2));
        }
        // Trust indicators
        if (m._pinData?.attestations?.length) {
          const trust = pinTrustIndicator(m._pinData, state.signingPublicKey);
          m._pinTrustScore = trust.score;
          m._pinTrustColor = trust.color;
          m._pinTrustLevel = trust.level;
        } else {
          m._pinTrustScore = 0;
          m._pinTrustLevel = null;
        }
        m.on("click", (e) => {
          if (e.originalEvent.shiftKey) {
            L.DomEvent.stop(e);
            toggleMarkerSelection(m);
          }
        });
        markerMap.set(row.pin_id, m);
        state.clusterGroup?.addLayer(m);
        requestAnimationFrame(() => {
          const icon = m._icon;
          if (icon) {
            icon.classList.add("marker-animate");
            setTimeout(() => icon.classList.remove("marker-animate"), 500);
          }
        });
      } else {
        m._pinTitle = pin.title || "";
        m._pinEmoji = row.emoji;
        m._media = row.media;
        m._authorPubkey = row.author_pubkey || null;
        m._pinData = pin;
        m._layerId = layerId;
        m._layerName = layerName;
        m._layerColor = layerColor;
        m._validFrom = row.valid_from !== undefined ? row.valid_from : null;
        m._validTo = row.valid_until !== undefined ? row.valid_until : null;
        m._customData = row.custom_data;
        m._schemaId = row.schema_id;
        m._ttlExpiresAt = row.ttl_expires_at || null;
        m._ttlVoteUp = row.vote_count_up || 0;
        m._ttlVoteDown = row.vote_count_down || 0;
        m._postedAnonymously = row.posted_anonymously || false;
        m._pinZoom = row.map_zoom || 13;
        // Trust indicators
        if (m._pinData?.attestations?.length) {
          const trust = pinTrustIndicator(m._pinData, state.signingPublicKey);
          m._pinTrustScore = trust.score;
          m._pinTrustColor = trust.color;
          m._pinTrustLevel = trust.level;
        } else {
          m._pinTrustScore = 0;
          m._pinTrustLevel = null;
        }
        if (row.posted_anonymously) {
          m.setOpacity(Math.max(opacity * 0.7, 0.2));
        } else {
          m.setOpacity(opacity);
        }
        m.setIcon(pinIcon(pin.color || "#2563eb", row.emoji));
      }
      state.pinSearchText.push((pin.title + " " + pin.note).toLowerCase());
      (function(marker, pinData, rowData) {
        marker.bindPopup(function () {
          let mh = "";
          const r = marker._media;
          if (r) {
            try {
              const mt = r.type;
              let tag = null;
              if (mt && mt.startsWith("image/")) tag = "img";
              else if (mt && mt.startsWith("video/")) tag = "video";
              else if (mt && mt.startsWith("audio/")) tag = "audio";
              if (tag) {
                try {
                  const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
                  const blob = new Blob([dec], { type: mt });
                  const url = URL.createObjectURL(blob);
            if (tag === "img")
              mh = `<br><img src="${url}" style="max-width:200px;max-height:150px;margin-top:4px;">`;
            else if (tag === "video")
              mh = `<br><video src="${url}" controls style="max-width:200px;max-height:150px;margin-top:4px;"></video>`;
            else if (tag === "audio")
              mh = `<br><audio src="${url}" controls style="width:100%;max-width:200px;"></audio>`;
                } catch (e) { console.warn("[popup] media render failed:", e.message); ov.innerHTML += `<div style="color:#dc2626;font-size:11px;margin-top:4px;">Media unavailable</div>`; }
              }
            } catch (e) { console.warn("[popup] media decrypt failed:", e.message); }
          }
          const rt = relativeTime(marker._createdAt);
          const customHtml = buildCustomDataHTML(marker._pinData, rowData.custom_data, marker._layerId, marker._layerName, rowData.schema_id);
          const layerBadge = marker._layerName
            ? `<br><span class="layer-badge" style="border-color:${marker._layerColor};">📑 ${escapeHtml(marker._layerName)}</span>`
            : "";
          const isEmbed = window._isEmbed || false;
          const isAnon = marker._postedAnonymously;
          const isOwner = !isAnon && rowData.author_pubkey && rowData.author_pubkey === state.signingPublicKey;
          const myRole = state.myRole;
          const canModerate = myRole === "maintainer" || myRole === "founder";
          const canEdit = !isEmbed && !isAnon && (isOwner || canModerate) && myRole !== "reader";
          const canDelete = !isEmbed && !isAnon && (isOwner || canModerate) && myRole !== "reader";
          const anonBadge = isAnon ? `<br><span style="font-size:10px;color:var(--text-muted);">anonymous</span>` : "";
          const trustBadge = marker._pinTrustLevel && marker._pinTrustLevel !== "neutral"
            ? `<span style="font-size:9px;color:${marker._pinTrustColor || "#9ca3af"};margin-left:4px;">${marker._pinTrustLevel}</span>`
            : "";
          let ttlHtml = "";
          if (gov.ttl_enabled) {
            const atts = marker._pinData?.attestations || [];
            const up = atts.filter(a => a.type === "confirmed").length;
            const down = atts.filter(a => a.type === "disputed").length + atts.filter(a => a.type === "flagged").length;
            const expired = marker._ttlExpiresAt && marker._ttlExpiresAt < Date.now();
            const remaining = marker._ttlExpiresAt ? marker._ttlExpiresAt - Date.now() : (gov.ttl_base_mins || 10080) * 60000;
            if (expired) {
              ttlHtml = `<br><small style="color:#dc2626;">⏳ Expired · ✅ ${up} ⚠️🚩 ${down}</small>`;
            } else if (remaining > 0) {
              const mins = Math.ceil(remaining / 60000);
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Expires in ${h > 0 ? h + "h " : ""}${m}m · ✅ ${up} ⚠️🚩 ${down}</small>`;
            }
          }
          const hasAttestBtns = !isEmbed && !isAnon && state.signingSecretKey && rowData.author_pubkey !== state.signingPublicKey;
          const attestBtns = hasAttestBtns
            ? `<br><button class="attest-confirm-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="padding:2px 8px;border:1px solid #16a34a;background:var(--bg-card);color:#16a34a;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">✅</button><button class="attest-dispute-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="padding:2px 8px;border:1px solid #f97316;background:var(--bg-card);color:#f97316;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⚠️</button><button class="attest-flag-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="padding:2px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">🚩</button>`
            : "";
          const isTutorial = window._tutorialPids?.includes(rowData.pin_id);
          const editBtns = (isTutorial || !isOwner) ? "" : `${canEdit ? `<button class="edit-pin-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">${t("edit")}</button>` : ""}${canDelete ? `<button class="delete-pin-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">${t("delete")}</button>` : ""}`;
           return `<div style="position:relative;"><button class="pin-expand-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="position:absolute;top:2px;right:2px;padding:1px 6px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:14px;line-height:1.3;color:var(--text-dim);" title="${t("expand") || "Expand"}">↗</button><b>${escapeHtml(pinData.title)}</b>${marker._pinEmoji ? " " + marker._pinEmoji : ""}${anonBadge}${trustBadge}<br>${escapeHtml(pinData.note)}${customHtml}${mh}<br><small style="color:var(--text-dim)">${rt}</small>${ttlHtml}${layerBadge}${attestBtns}${editBtns ? "<br>" + editBtns : ""}<hr style="margin:8px 0 4px;border-color:var(--border);"><div class="annotation-thread" data-pin-id="${escapeHtml(rowData.pin_id)}" style="max-height:240px;overflow-y:auto;font-size:12px;">Loading...</div></div>`;
        });
      })(m, pin, row);
      state.markers.push(m);
    } catch (err) { console.warn("[loadPins] failed to load pin:", row.pin_id, err); window._toast?.("Some pins failed to load", "#f97316"); }
  }
  for (const [id, marker] of markerMap) {
    if (!keepIds.has(id)) {
      state.clusterGroup?.removeLayer(marker);
      markerMap.delete(id);
    }
  }
  applyTimeFilter();
  } finally {
    state._loadPinsBusy = false;
    const container = state.map?.getContainer();
    if (container) container.classList.remove("pins-loading");
    if (state._pinsNeedReload) {
      state._pinsNeedReload = false;
      setTimeout(() => loadPins(), 50);
    }
  }
}

export function refreshPinMarkerPopup(marker) {
  if (!marker || !marker._pinId) return;
  const rowData = { pin_id: marker._pinId, author_pubkey: marker._authorPubkey };
  const pinData = marker._pinData || {};
  const gov = {
    ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360,
    ttl_min_mins: 60, ttl_max_mins: 43200,
    ...(state.currentCommunity?.governance || {}),
  };
  const isEmbed = window._isEmbed || false;
  const isAnon = marker._postedAnonymously;
  const isOwner = !isAnon && rowData.author_pubkey && rowData.author_pubkey === state.signingPublicKey;
  const myRole = state.myRole;
  const canModerate = myRole === "maintainer" || myRole === "founder";
  const canEdit = !isEmbed && !isAnon && (isOwner || canModerate) && myRole !== "reader";
  const canDelete = !isEmbed && !isAnon && (isOwner || canModerate) && myRole !== "reader";
  const isTutorial = window._tutorialPids?.includes(marker._pinId);
  const editBtns = (isEmbed || isAnon || !isOwner || isTutorial) ? "" : `<button class="edit-pin-btn" data-pid="${escapeHtml(marker._pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">Edit</button> <button class="delete-pin-btn" data-pid="${escapeHtml(marker._pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">Delete</button>`;
  const anonBadge = isAnon ? `<br><span style="font-size:10px;color:var(--text-muted);">anonymous</span>` : "";
  const trust = (marker._pinTrustLevel != null) ? { level: marker._pinTrustLevel, color: marker._pinTrustColor } : pinTrustIndicator(marker._pinData || {}, state.signingPublicKey);
  const trustBadge = trust?.level && trust.level !== "neutral"
    ? `<span style="font-size:9px;color:${trust.color || "#9ca3af"};margin-left:4px;">${trust.level}</span>`
    : "";

  let mediaHtml = "";
  const r = marker._media;
  if (r) {
    try {
      const mt = r.type;
      let tag = null;
      if (mt && mt.startsWith("image/")) tag = "img";
      else if (mt && mt.startsWith("video/")) tag = "video";
      if (tag) {
        const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
        const blob = new Blob([dec], { type: mt });
        const url = URL.createObjectURL(blob);
        if (tag === "img")
          mediaHtml = `<br><img src="${url}" style="max-width:200px;max-height:150px;margin-top:4px;">`;
        else if (tag === "video")
          mediaHtml = `<br><video src="${url}" controls style="max-width:200px;max-height:150px;margin-top:4px;"></video>`;
        else if (tag === "audio")
          mediaHtml = `<br><audio src="${url}" controls style="width:100%;max-width:200px;"></audio>`;
      }
    } catch (_) {}
  }

  const customHtml = buildCustomDataHTML(marker._pinData, marker._customData, marker._layerId, marker._layerName, marker._schemaId);

  const rt = relativeTime(marker._createdAt);
  const layerBadge = marker._layerName
    ? `<br><span class="layer-badge" style="border-color:${marker._layerColor};">📑 ${escapeHtml(marker._layerName)}</span>`
    : "";

          let ttlHtml = "";
          if (gov.ttl_enabled) {
            const atts = marker._pinData?.attestations || [];
            const up = atts.filter(a => a.type === "confirmed").length;
            const down = atts.filter(a => a.type === "disputed").length + atts.filter(a => a.type === "flagged").length * 3;
            if (marker._ttlExpiresAt) {
              const remaining = marker._ttlExpiresAt - Date.now();
              if (remaining > 0) {
                const mins = Math.ceil(remaining / 60000);
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Expires in ${h > 0 ? h + "h " : ""}${m}m · ✅ ${up} ⚠️🚩 ${down}</small>`;
              } else {
                ttlHtml = `<br><small style="color:#dc2626;">⏳ Expired · ✅ ${up} ⚠️🚩 ${down}</small>`;
              }
            } else {
              ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Pending · ✅ ${up} ⚠️🚩 ${down}</small>`;
            }
          }
  const hasAttestBtns = !isEmbed && !isAnon && state.signingSecretKey && marker._authorPubkey !== state.signingPublicKey;
  const attestBtns = hasAttestBtns
    ? `<br><button class="attest-confirm-btn" data-pid="${escapeHtml(marker._pinId)}" style="padding:2px 8px;border:1px solid #16a34a;background:var(--bg-card);color:#16a34a;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">✅</button><button class="attest-dispute-btn" data-pid="${escapeHtml(marker._pinId)}" style="padding:2px 8px;border:1px solid #f97316;background:var(--bg-card);color:#f97316;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⚠️</button><button class="attest-flag-btn" data-pid="${escapeHtml(marker._pinId)}" style="padding:2px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">🚩</button>`
    : "";
  const html = `<div style="position:relative;"><button class="pin-expand-btn" data-pid="${escapeHtml(marker._pinId)}" style="position:absolute;top:2px;right:2px;padding:1px 6px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:14px;line-height:1.3;color:var(--text-dim);" title="${t("expand") || "Expand"}">↗</button><b>${escapeHtml(pinData.title || "")}</b>${marker._pinEmoji ? " " + marker._pinEmoji : ""}${anonBadge}${trustBadge}<br>${escapeHtml(pinData.note || "")}${customHtml}${mediaHtml}<br><small style="color:var(--text-dim)">${rt}</small>${ttlHtml}${layerBadge}${attestBtns}${editBtns ? "<br>" + editBtns : ""}<hr style="margin:8px 0 4px;border-color:var(--border);"><div class="annotation-thread" data-pin-id="${escapeHtml(marker._pinId)}" style="max-height:240px;overflow-y:auto;font-size:12px;">Loading...</div></div>`;
  marker.unbindPopup();
  marker.bindPopup(html);
  marker.openPopup();
}

export function showPinDetailModal(pinId) {
  const marker = state.markers.find(m => m._pinId === pinId);
  if (!marker || !state.dek) return;

  if (window._pinDetailClean) { window._pinDetailClean(); window._pinDetailClean = null; }

  const pinData = marker._pinData || {};
  const gov = {
    ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360,
    ttl_min_mins: 60, ttl_max_mins: 43200,
    ...(state.currentCommunity?.governance || {}),
  };
  const isEmbed = window._isEmbed || false;
  const isAnon = marker._postedAnonymously;
  const isOwner = !isAnon && marker._authorPubkey && marker._authorPubkey === state.signingPublicKey;
  const myRole = state.myRole;
  const canModerate = myRole === "maintainer" || myRole === "founder";
  const canEdit = !isEmbed && !isAnon && (isOwner || canModerate) && myRole !== "reader";
  const canDelete = !isEmbed && !isAnon && (isOwner || canModerate) && myRole !== "reader";
  const isTutorial = window._tutorialPids?.includes(pinId);
  const editBtns = (isEmbed || isAnon || !isOwner || isTutorial) ? "" : `<button class="edit-pin-btn" data-pid="${escapeHtml(pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">${t("edit")}</button> <button class="delete-pin-btn" data-pid="${escapeHtml(pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">${t("delete")}</button>`;
  const mediaUrls = [];
  let mediaHtml = "";
  const r = marker._media;
  if (r) {
    try {
      const mt = r.type;
      let tag = null;
      if (mt && mt.startsWith("image/")) tag = "img";
      else if (mt && mt.startsWith("video/")) tag = "video";
      else if (mt && mt.startsWith("audio/")) tag = "audio";
      if (tag) {
        const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
        const blob = new Blob([dec], { type: mt });
        const url = URL.createObjectURL(blob);
        mediaUrls.push(url);
        if (tag === "img")
          mediaHtml = `<br><img src="${url}" style="max-width:100%;max-height:50vh;margin-top:6px;border-radius:4px;">`;
        else if (tag === "video")
          mediaHtml = `<br><video src="${url}" controls style="max-width:100%;max-height:50vh;margin-top:6px;border-radius:4px;"></video>`;
        else if (tag === "audio")
          mediaHtml = `<br><audio src="${url}" controls style="width:100%;"></audio>`;
      }
    } catch (_) {}
  }

          let ttlHtml = "";
          if (gov.ttl_enabled) {
            const atts = marker._pinData?.attestations || [];
            const up = atts.filter(a => a.type === "confirmed").length;
            const down = atts.filter(a => a.type === "disputed").length + atts.filter(a => a.type === "flagged").length * 3;
            if (marker._ttlExpiresAt) {
              const remaining = marker._ttlExpiresAt - Date.now();
              if (remaining > 0) {
                const mins = Math.ceil(remaining / 60000);
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Expires in ${h > 0 ? h + "h " : ""}${m}m · ✅ ${up} ⚠️🚩 ${down}</small>`;
              } else {
                ttlHtml = `<br><small style="color:#dc2626;">⏳ Expired · ✅ ${up} ⚠️🚩 ${down}</small>`;
              }
            } else {
              ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Pending · ✅ ${up} ⚠️🚩 ${down}</small>`;
            }
          }

  const customHtml = buildCustomDataHTML(pinData, marker._customData, marker._layerId, marker._layerName, marker._schemaId);

  const layerBadge = marker._layerName
    ? `<br><span class="layer-badge" style="border-color:${marker._layerColor};">📑 ${escapeHtml(marker._layerName)}</span>`
    : "";

  const hasAttestBtns = !isEmbed && !isAnon && state.signingSecretKey && marker._authorPubkey !== state.signingPublicKey;
  const attestBtns = hasAttestBtns
    ? `<button class="attest-confirm-btn" data-pid="${escapeHtml(pinId)}" style="padding:2px 8px;border:1px solid #16a34a;background:var(--bg-card);color:#16a34a;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">✅</button><button class="attest-dispute-btn" data-pid="${escapeHtml(pinId)}" style="padding:2px 8px;border:1px solid #f97316;background:var(--bg-card);color:#f97316;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">⚠️</button><button class="attest-flag-btn" data-pid="${escapeHtml(pinId)}" style="padding:2px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">🚩</button>`
    : "";
  const rt = relativeTime(marker._createdAt);

  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";

  ov.innerHTML = `<div class="pin-detail-card" style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:560px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div style="font-size:18px;font-weight:600;word-break:break-word;">${marker._pinEmoji ? marker._pinEmoji + " " : ""}${escapeHtml(pinData.title || "")}</div>
      <button id="pin-detail-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;flex-shrink:0;margin-left:8px;">×</button>
    </div>
    ${isAnon ? '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">anonymous</div>' : ""}
    <div style="overflow-y:auto;flex:1;">
      <div style="font-size:14px;color:var(--text);white-space:pre-wrap;word-break:break-word;margin-bottom:8px;">${escapeHtml(pinData.note || "")}</div>
      ${customHtml}
      ${mediaHtml}
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">${rt}</div>
      ${ttlHtml}
      ${layerBadge}
      <div style="margin-top:8px;">${attestBtns ? attestBtns + "<br>" : ""}${editBtns ? editBtns : ""}</div>
      <hr style="margin:12px 0 8px;border-color:var(--border);">
      <div class="annotation-thread pin-detail-thread" data-pin-id="${escapeHtml(pinId)}" style="max-height:none;overflow-y:visible;font-size:13px;">Loading...</div>
    </div>
  </div>`;

  document.body.appendChild(ov);

  const card = ov.querySelector(".pin-detail-card");
  const threadEl = ov.querySelector(".pin-detail-thread");

  const clean = () => {
    for (const u of mediaUrls) URL.revokeObjectURL(u);
    ov.remove();
    window._pinDetailClean = null;
  };
  window._pinDetailClean = clean;

  ov.querySelector("#pin-detail-close").onclick = clean;

  ov.addEventListener("click", (e) => {
    if (e.target === ov) clean();
  });

  card.addEventListener("click", (e) => {
    if (e.target.matches(".edit-pin-btn")) {
      setTimeout(() => clean(), 100);
    }
  }, true);

  renderAnnotationThread(pinId, threadEl);
}

const _selectedMarkers = new Set();
function toggleMarkerSelection(m) {
  if (_selectedMarkers.has(m)) {
    _selectedMarkers.delete(m);
    m.setIcon(pinIcon(m._pinColor || "#2563eb"));
  } else {
    _selectedMarkers.add(m);
    m.setIcon(pinIcon("#f59e0b"));
  }
}

export function clearSelection() {
  for (const m of _selectedMarkers)
    m.setIcon(pinIcon(m._pinColor || "#2563eb"));
  _selectedMarkers.clear();
}

export async function deleteSelected() {
  if (_selectedMarkers.size === 0) {
    // If nothing selected, delete currently open popup's pin
    const popup = state.map?.getPopup();
    if (popup) {
      const el = popup.getContent();
      const pid =
        typeof el === "string" ? el.match(/data-pid="([^"]+)"/)?.[1] : null;
      if (pid) await deletePin(pid);
    }
    return;
  }
  if (
    !(await confirmDialog(
      `Delete ${_selectedMarkers.size} pin${_selectedMarkers.size > 1 ? "s" : ""}?`,
    ))
  )
    return;
  for (const m of _selectedMarkers) {
    const pid = m._pinId;
    if (pid) await DB.deletePin(pid);
  }
  clearSelection();
  await loadPins();
}

export function placePin() {
  if (!state.map || !state.currentSet) return;
  const c = state.map.getCenter();
  showPinForm(c.lat, c.lng);
}

// Undo/redo
const _undoStack = [];
const _redoStack = [];
const MAX_UNDO = 30;

export function pushUndo(action) {
  _undoStack.push(action);
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack.length = 0;
}

export async function undo() {
  const action = _undoStack.pop();
  if (!action) return;
  playUndo();
  if (action.kind === "pin") {
    _redoStack.push({
      kind: "pin",
      type: action.type === "delete" ? "save" : "delete",
      pin: action.pin,
      pid: action.pid,
    });
    if (action.type === "delete") {
      await DB.savePin(action.pin);
      window._broadcast?.("new_pin", action.pin);
    } else {
      await DB.deletePin(action.pid);
      window._broadcast?.("delete_pin", { pin_id: action.pid });
    }
    await loadPins();
  } else if (action.kind === "drawing") {
    _redoStack.push({
      kind: "drawing",
      type: action.type === "delete" ? "save" : "delete",
      drawing: action.drawing,
      did: action.did,
    });
    if (action.type === "delete") {
      await DB.saveDrawing(action.drawing);
      window._broadcast?.("new_drawing", action.drawing);
    } else {
      await DB.deleteDrawing(action.did);
      window._broadcast?.("delete_drawing", { drawing_id: action.did });
    }
    await loadDrawings();
  }
}

export async function redo() {
  const action = _redoStack.pop();
  if (!action) return;
  playRedo();
  if (action.kind === "pin") {
    _undoStack.push({
      kind: "pin",
      type: action.type === "delete" ? "save" : "delete",
      pin: action.pin,
      pid: action.pid,
    });
    if (action.type === "delete") {
      await DB.savePin(action.pin);
      window._broadcast?.("new_pin", action.pin);
    } else {
      await DB.deletePin(action.pid);
      window._broadcast?.("delete_pin", { pin_id: action.pid });
    }
    await loadPins();
  } else if (action.kind === "drawing") {
    _undoStack.push({
      kind: "drawing",
      type: action.type === "delete" ? "save" : "delete",
      drawing: action.drawing,
      did: action.did,
    });
    if (action.type === "delete") {
      await DB.saveDrawing(action.drawing);
      window._broadcast?.("new_drawing", action.drawing);
    } else {
      await DB.deleteDrawing(action.did);
      window._broadcast?.("delete_drawing", { drawing_id: action.did });
    }
    await loadDrawings();
  }
}

export async function savePin(lat, lng, title, note, color, media, emoji, layerId, schemaId, customData, validFrom, validUntil, postedAnonymously) {
  if (!state.dek || !state.currentSet) return;
  if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    toast("Invalid coordinates", "#dc2626"); return;
  }
  title = String(title || "Untitled").slice(0, 500);
  emoji = String(emoji || "").replace(/<[^>]*>/g, "").slice(0, 8);
  const pid = generate_uuid();
  const enc = encrypt_pin_data(title, note, lat, lng, color, state.dek);
  const pin = {
    pin_id: pid,
    team_id: state.currentSet,
    layer_id: layerId || (state.layers[0] ? state.layers[0].layer_id : null),
    ciphertext: enc.ciphertext,
    nonce: enc.nonce,
    created_at: Date.now(),
    map_zoom: state.map?.getZoom() || 13,
  };
  if (!postedAnonymously && state.signingPublicKey) pin.author_pubkey = state.signingPublicKey;
  if (postedAnonymously) pin.posted_anonymously = true;

  // Creation attestation
  if (!postedAnonymously && state.signingPublicKey && state.signingSecretKey) {
    const creationPayload = pid + "created" + pin.created_at;
    pin.attestations = [{
      pubkey: state.signingPublicKey,
      type: "created",
      timestamp: pin.created_at,
      signature: sign(creationPayload, state.signingSecretKey),
    }];
  }
  const gov = {
    ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360,
    ttl_min_mins: 60, ttl_max_mins: 43200,
    ...(state.currentCommunity?.governance || {}),
  };
  if (gov.ttl_enabled) {
    const now = Date.now();
    pin.ttl_base_at = now;
    pin.ttl_expires_at = now + ((gov.ttl_base_mins || 10080) * 60000);
  }
  if (schemaId) pin.schema_id = schemaId;
  if (customData) {
    const cdEnc = encrypt_raw_bytes(new TextEncoder().encode(JSON.stringify(customData)), state.dek);
    pin.custom_data = { ciphertext: cdEnc.ciphertext, nonce: cdEnc.nonce };
  }
  if (validFrom !== null && validFrom !== undefined && validFrom !== "") pin.valid_from = parseInt(validFrom);
  if (validUntil !== null && validUntil !== undefined && validUntil !== "") pin.valid_until = parseInt(validUntil);
  if (media) pin.media = media;
  if (emoji) pin.emoji = emoji;
  await DB.savePin(pin);
  if (state._decryptedPinCache) state._decryptedPinCache.delete(pid);
  pushUndo({ kind: "pin", type: "save", pin, pid });
  window._broadcast?.("new_pin", pin);
  await loadPins();
  window._addHistory?.(t("pinAdded"), title);
  try { navigator.vibrate?.(20); } catch (_) {}
  playPinDrop();
}

export async function deletePin(pid) {
  const pins = await DB.getPins(state.currentSet);
  const row = pins.find((p) => p.pin_id === pid);
  if (row) pushUndo({ kind: "pin", type: "delete", pin: row, pid });
  await DB.deletePin(pid);
  if (state._decryptedPinCache) state._decryptedPinCache.delete(pid);
  window._broadcast?.("delete_pin", { pin_id: pid });
  await loadPins();
  window._addHistory?.(t("pinDeleted"), pid.slice(0, 8));
  try { navigator.vibrate?.(20); } catch (_) {}
  window._toast?.("Pin deleted. Undo?", "#f97316", 5000, () => { undo(); });
}

export async function updatePin(pid, title, note, color, media, emoji, layerId, schemaId, customData, validFrom, validUntil) {
  if (!state.dek || !state.currentSet) return;
  title = String(title || "Untitled").slice(0, 500);
  emoji = String(emoji || "").replace(/<[^>]*>/g, "").slice(0, 8);
  const pins = await DB.getPins(state.currentSet);
  const row = pins.find((p) => p.pin_id === pid);
  if (!row) return;
  const pin = decrypt_pin_data(row.ciphertext, row.nonce, state.dek);
  const enc = encrypt_pin_data(title, note, pin.lat, pin.lng, color, state.dek);
  const updated = {
    pin_id: pid,
    team_id: state.currentSet,
    layer_id: layerId !== undefined ? layerId : row.layer_id,
    ciphertext: enc.ciphertext,
    nonce: enc.nonce,
    created_at: row.created_at || Date.now(),
    map_zoom: row.map_zoom || 13,
    ttl_base_at: row.ttl_base_at,
    ttl_expires_at: row.ttl_expires_at,
    vote_count_up: row.vote_count_up ?? 0,
    vote_count_down: row.vote_count_down ?? 0,
    attestations: row.attestations || [],
    posted_anonymously: row.posted_anonymously || false,
  };
  if (schemaId !== undefined) updated.schema_id = schemaId;
  else if (row.schema_id) updated.schema_id = row.schema_id;
  if (customData !== undefined && customData !== null) {
    const cdEnc = encrypt_raw_bytes(new TextEncoder().encode(JSON.stringify(customData)), state.dek);
    updated.custom_data = { ciphertext: cdEnc.ciphertext, nonce: cdEnc.nonce };
  } else if (row.custom_data) updated.custom_data = row.custom_data;
  if (media !== undefined) updated.media = media;
  else if (row.media) updated.media = row.media;
  if (emoji !== undefined) updated.emoji = emoji;
  else if (row.emoji) updated.emoji = row.emoji;
  if (validFrom !== undefined) updated.valid_from = validFrom !== "" ? parseInt(validFrom) : null;
  else if (row.valid_from !== undefined) updated.valid_from = row.valid_from;
  if (validUntil !== undefined) updated.valid_until = validUntil !== "" ? parseInt(validUntil) : null;
  else if (row.valid_until !== undefined) updated.valid_until = row.valid_until;
  if (row.author_pubkey) updated.author_pubkey = row.author_pubkey;
  await DB.savePin(updated);
  if (state._decryptedPinCache) state._decryptedPinCache.delete(pid);
  window._broadcast?.("new_pin", updated);
  await loadPins();
  window._addHistory?.(t("pinEdited"), title);
}

export function showEditPinForm(pid) {
  if (!state.dek || !state.currentSet) return;
  DB.getPins(state.currentSet)
    .then((pins) => {
      const row = pins.find((p) => p.pin_id === pid);
      if (!row) return;
      const pin = decrypt_pin_data(row.ciphertext, row.nonce, state.dek);
      const ov = document.createElement("div");
      ov.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
      const curColor = pin.color || "#2563eb";
      const curEmoji = row.emoji || "";
      const colorCircles = colorPresetsHTML(COLORS, curColor);
      const editHueHtml = hueDotHTML(curColor, "edit-pin-hue");
      const editHexHtml = hexInputHTML("edit-pin-hex", escapeHtml(curColor));
      const layerOptions = state.layers.map(l => `<option value="${l.layer_id}" ${l.layer_id === row.layer_id ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("");
      const schemaOpts = `<option value="">none</option>` + state.schemas.map(s => `<option value="${s.schema_id}" ${s.schema_id === row.schema_id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
      ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("editPin")}</h3><input id="edit-pin-title" placeholder="${t("title")}" value="${escapeHtml(pin.title)}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" /><textarea id="edit-pin-note" placeholder="${t("description")}" rows="3" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;resize:vertical;">${escapeHtml(pin.note)}</textarea><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("color")}</div><div id="edit-pin-color-picker" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">${colorCircles}${editHueHtml}${editHexHtml}</div><input type="hidden" id="edit-pin-color" value="${escapeHtml(curColor)}" /><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("emoji") || "Emoji"}</div><div style="display:flex;gap:4px;margin-bottom:8px;"><input type="text" id="edit-pin-emoji" value="${escapeHtml(curEmoji)}" placeholder="😊" maxlength="2" style="width:56px;height:42px;text-align:center;font-size:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);padding:0;box-sizing:border-box;" /><button type="button" id="edit-pin-emoji-btn" style="width:28px;height:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;">😊</button></div><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("layer") || "Layer"}</div><select id="edit-pin-layer" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${layerOptions}</select><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("schema") || "Schema"}</div><select id="edit-pin-schema" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${schemaOpts}</select><div id="edit-schema-fields" style="margin-bottom:8px;"></div><div style="display:flex;gap:4px;margin-bottom:8px;"><div style="flex:1;"><span style="font-size:11px;color:var(--text-dim);">${t("timeFrom") || "From (year)"}</span><input id="edit-pin-time-from" type="number" placeholder="any" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div><div style="flex:1;"><span style="font-size:11px;color:var(--text-dim);">${t("timeTo") || "To (year)"}</span><input id="edit-pin-time-to" type="number" placeholder="any" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div></div><label style="font-size:12px;color:var(--text-dim);">${t("replaceMedia")}</label><input type="file" id="edit-pin-media" accept="image/*,video/*" style="font-size:12px;padding:4px;border:1px solid var(--border);border-radius:3px;width:100%;box-sizing:border-box;margin-bottom:12px;background:var(--bg-input);" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="edit-pin-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="edit-pin-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
      document.body.appendChild(ov);
      document.getElementById("edit-pin-title").focus();
      const clean = () => ov.remove();
      document.getElementById("edit-pin-cancel").onclick = clean;
      ov.onclick = (e) => {
        if (e.target === ov) clean();
      };
      document
        .getElementById("edit-pin-title")
        .addEventListener("keydown", (e) => {
          if (e.key === "Enter")
            document.getElementById("edit-pin-save").click();
        });
      const picker = document.getElementById("edit-pin-color-picker");
      wireColorPicker("edit-pin-color-picker", "edit-pin-color", "edit-pin-hex", COLORS);

      // Schema fields — render from selected schema
      renderSchemaFieldsById(row.schema_id, "edit-schema-fields", row.custom_data);
      document.getElementById("edit-pin-schema").addEventListener("change", () => {
        const sid = document.getElementById("edit-pin-schema").value;
        renderSchemaFieldsById(sid || null, "edit-schema-fields", row.custom_data);
      });
      // Pre-fill time fields
      if (row.valid_from) document.getElementById("edit-pin-time-from").value = row.valid_from;
      if (row.valid_until) document.getElementById("edit-pin-time-to").value = row.valid_until;
      // Sync schema dropdown when layer changes
      document.getElementById("edit-pin-layer").addEventListener("change", () => {
        const lid = document.getElementById("edit-pin-layer").value;
        const layer = state.layers.find(l => l.layer_id === lid);
        const sid = layer?.default_schema_id || "";
        document.getElementById("edit-pin-schema").value = sid;
        renderSchemaFieldsById(sid || null, "edit-schema-fields", row.custom_data);
      });

      const editPinEmojiBtn = document.getElementById("edit-pin-emoji-btn");
      const editPinEmojiInput = document.getElementById("edit-pin-emoji");
      editPinEmojiBtn.onclick = () => {
        editPinEmojiInput.focus();
        document.execCommand?.("insertText", false, "😊");
      };
      document.getElementById("edit-pin-save").onclick = async () => {
        const t = document.getElementById("edit-pin-title").value.trim();
        const n = document.getElementById("edit-pin-note").value.trim();
        const color = document.getElementById("edit-pin-color").value;
        const emoji = document.getElementById("edit-pin-emoji").value.trim();
        const layerId = document.getElementById("edit-pin-layer").value;
        const schemaData = collectSchemaData("edit-schema-fields");
        const schemaId = document.getElementById("edit-pin-schema").value || null;
        const validFrom = document.getElementById("edit-pin-time-from").value;
        const validUntil = document.getElementById("edit-pin-time-to").value;
        const file = document.getElementById("edit-pin-media").files[0];
        let media = undefined;
    if (file) {
      await checkStorageQuota(file.size, "attachment");
      const c = await compressMedia(file);
      const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
      media = {
            type: c.type,
            name: c.name,
            ciphertext: enc.ciphertext,
            nonce: enc.nonce,
          };
        }
        clean();
        await updatePin(pid, t || "Untitled", n, color, media, emoji, layerId, schemaId, schemaData, validFrom, validUntil);
        state.map.closePopup();
      };
    })
    .catch(() => {});
}

export function showDrawingForm(g) {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  const colorCircles = colorPresetsHTML(COLORS, "#2563eb");
  const layerOpts = state.layers.map(l => `<option value="${l.layer_id}">${escapeHtml(l.name)}</option>`).join("");
  const isColl = g.type === "FeatureCollection";
  let radiusHtml = "";
  if (isColl) {
    let d = 0;
    for (const f of g.features) {
      if (f.geometry?.type === "LineString") {
        const c = f.geometry.coordinates;
        for (let i = 1; i < c.length; i++)
          d += L.latLng(c[i - 1][1], c[i - 1][0]).distanceTo([c[i][1], c[i][0]]);
      }
    }
    if (d > 0) radiusHtml = `<div style="margin-bottom:10px;padding:6px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:12px;color:#166534;"><b>${t("length")}:</b> ${fmtDist(d)}</div>`;
  } else if (g.geometry?.type === "LineString") {
    const c = g.geometry.coordinates;
    let d = 0;
    for (let i = 1; i < c.length; i++)
      d += L.latLng(c[i - 1][1], c[i - 1][0]).distanceTo([c[i][1], c[i][0]]);
    radiusHtml = `<div style="margin-bottom:10px;padding:6px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:12px;color:#166534;"><b>${t("length")}:</b> ${fmtDist(d)}</div>`;
  }
  if (g.geometry?.type === "Point" && g.properties?.radius) {
    const r = g.properties.radius;
    radiusHtml = `<div style="margin-bottom:10px;padding:6px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:12px;color:#166534;"><b>${t("circumference")}:</b> ${fmtDist(2 * Math.PI * r)}<br><b>${t("diameter")}:</b> ${fmtDist(r * 2)}<br><b>${t("area")}:</b> ${fmtArea(Math.PI * r * r)}&nbsp;${toggleLink()}</div>`;
  }
  ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("newDrawing")}</h3>${radiusHtml}<input id="drawing-title" placeholder="${t("title")}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" /><textarea id="drawing-note" placeholder="${t("description")}" rows="3" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;resize:vertical;"></textarea><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("color")}</div><div id="drawing-color-picker" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;">${colorCircles}</div><input type="hidden" id="drawing-color" value="#2563eb" /><label style="display:flex;align-items:center;gap:4px;font-size:12px;margin-bottom:8px;"><input type="checkbox" id="drawing-arrow" /> ${t("arrow")}</label><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("layer") || "Layer"}</div><select id="drawing-layer" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${layerOpts}</select><label style="font-size:12px;color:var(--text-dim);">${t("attachment")}</label><input type="file" id="drawing-media" style="font-size:12px;padding:4px;border:1px solid var(--border);border-radius:3px;width:100%;box-sizing:border-box;margin-bottom:12px;background:var(--bg-input);" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="drawing-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="drawing-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
  document.body.appendChild(ov);
  document.getElementById("drawing-title").focus();
  const clean = () => ov.remove();
  document.getElementById("drawing-cancel").onclick = clean;
  ov.onclick = (e) => {
    if (e.target === ov) clean();
  };
  document.getElementById("drawing-title").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("drawing-save").click();
  });
  const picker = document.getElementById("drawing-color-picker");
  wireColorPicker("drawing-color-picker", "drawing-color", null, COLORS);
  document.getElementById("drawing-save").onclick = async () => {
    const ti = document.getElementById("drawing-title").value.trim(),
      nn = document.getElementById("drawing-note").value.trim(),
      arrow = document.getElementById("drawing-arrow").checked;
    const color = document.getElementById("drawing-color").value;
    const layerId = document.getElementById("drawing-layer").value;
    g.properties = g.properties || {};
    g.properties.title = ti || "Drawing";
    g.properties.note = nn;
    g.properties.arrow = arrow;
    g.properties.color = color;
    if (isColl) {
      for (const f of g.features) {
        f.properties = f.properties || {};
        if (!f.properties.color) f.properties.color = color;
        if (arrow && f.geometry?.type === "LineString") f.properties.arrow = true;
      }
    }
    const file = document.getElementById("drawing-media").files[0];
    let media = null;
    if (file) {
      await checkStorageQuota(file.size, "attachment");
      const c = await compressMedia(file);
      const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
      media = {
        type: c.type,
        name: c.name,
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
      };
    }
    clean();
    await saveDrawing(g, media, layerId);
  };
}

export function showPinForm(lat, lng) {
  const gov = {
    ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360,
    ttl_min_mins: 60, ttl_max_mins: 43200, anonymous_posting: "forbidden",
    ...(state.currentCommunity?.governance || {}),
  };
  const ttlInfo = gov.ttl_enabled
    ? `<div style="font-size:10px;color:var(--text-dim);margin:4px 0;">⏳ TTL: ${gov.ttl_base_mins} min base + ${gov.ttl_vote_mins} min/vote · min ${gov.ttl_min_mins} · max ${gov.ttl_max_mins}</div>`
    : "";
  const anonOpt = (gov.anonymous_posting === "allowed" || gov.anonymous_posting === "members_only")
    ? `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="pin-anonymous" /> Post anonymously</label>`
    : "";
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  const colorCircles = colorPresetsHTML(COLORS, "#2563eb");
  const hueHtml = hueDotHTML("#2563eb", "pin-hue");
  const hexHtml = hexInputHTML("pin-hex", "#2563eb");
  const layerOptions = state.layers.map(l => `<option value="${l.layer_id}" ${l.layer_id === state.activeLayerId ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("");
  const activeLayer = state.layers.find(l => l.layer_id === state.activeLayerId);
  const defaultSchemaId = activeLayer?.default_schema_id || null;
  const schemaOptions = `<option value="">none</option>` + state.schemas.map(s => `<option value="${s.schema_id}" ${s.schema_id === defaultSchemaId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("newPin")}</h3><input id="pin-title" placeholder="${t("title")}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" /><textarea id="pin-note" placeholder="${t("description")}" rows="3" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;resize:vertical;"></textarea><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("color")}</div><div id="pin-color-picker" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">${colorCircles}${hueHtml}${hexHtml}</div><input type="hidden" id="pin-color" value="#2563eb" /><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("emoji") || "Emoji"}</div><div style="display:flex;gap:4px;margin-bottom:8px;"><input type="text" id="pin-emoji" placeholder="😊" maxlength="2" style="width:56px;height:42px;text-align:center;font-size:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);padding:0;box-sizing:border-box;" /><button type="button" id="pin-emoji-btn" style="width:28px;height:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;">😊</button></div><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("layer") || "Layer"}</div><select id="pin-layer" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${layerOptions}</select><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("schema") || "Schema"}</div><select id="pin-schema" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${schemaOptions}</select><div id="schema-fields" style="margin-bottom:8px;"></div><div style="display:flex;gap:4px;margin-bottom:8px;"><div style="flex:1;"><span style="font-size:11px;color:var(--text-dim);">${t("timeFrom") || "From (year)"}</span><input id="pin-time-from" type="number" placeholder="any" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div><div style="flex:1;"><span style="font-size:11px;color:var(--text-dim);">${t("timeTo") || "To (year)"}</span><input id="pin-time-to" type="number" placeholder="any" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div></div>${ttlInfo}${anonOpt}<label style="font-size:12px;color:var(--text-dim);">${t("photoVideo")}</label><input type="file" id="pin-media" accept="image/*,video/*" style="font-size:12px;padding:4px;border:1px solid var(--border);border-radius:3px;width:100%;box-sizing:border-box;margin-bottom:12px;background:var(--bg-input);" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="pin-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="pin-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
  document.body.appendChild(ov);
  document.getElementById("pin-title").focus();

  // --- Recording controls ---
  let mediaRecorder = null, mediaStream = null, recordedChunks = [], recordType = null;
  let recordBlob = null, recordTimer = null, recordStartTime = 0, _cameraFacing = "environment";

  function formatTime(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

  async function switchCamera() {
    if (!mediaStream || !recordType) return;
    const prevRecorder = mediaRecorder;
    const prevStream = mediaStream;
    // Null the old recorder's onstop so it doesn't interfere with the new session
    if (prevRecorder) prevRecorder.onstop = null;
    if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
    prevRecorder?.stop();
    prevStream.getTracks().forEach(t => t.stop());
    mediaRecorder = null; mediaStream = null; recordedChunks = [];
    _cameraFacing = _cameraFacing === "environment" ? "user" : "environment";
    if (recordType === "video") {
      startRecording("video");
    } else {
      startSnapPhoto();
    }
  }

  function createRecordingUI() {
    const mediaInput = document.getElementById("pin-media");
    if (!mediaInput || !window.MediaRecorder) return;
    // Video preview (shown only during video recording)
    const preview = document.createElement("video");
    preview.id = "rec-preview";
    preview.style.cssText = "display:none;width:100%;max-height:240px;margin-bottom:8px;border-radius:4px;background:#000;";
    preview.muted = true;
    preview.autoplay = true;
    preview.playsInline = true;
    mediaInput.parentNode.insertBefore(preview, mediaInput);
    // Recording bar
    const bar = document.createElement("div");
    bar.id = "rec-bar";
    bar.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:8px;";
    bar.innerHTML = `<button type="button" id="rec-video-btn" style="padding:4px 10px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:4px;cursor:pointer;font-size:12px;">📹 Record Video</button><button type="button" id="rec-audio-btn" style="padding:4px 10px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:4px;cursor:pointer;font-size:12px;">🎤 Record Audio</button><button type="button" id="rec-snap-btn" style="padding:4px 10px;border:1px solid #7c3aed;background:var(--bg-card);color:#7c3aed;border-radius:4px;cursor:pointer;font-size:12px;">📷 Snap Photo</button><span id="rec-status" style="display:none;font-size:12px;color:var(--text-dim);gap:6px;align-items:center;"></span>`;
    mediaInput.parentNode.insertBefore(bar, mediaInput);
    document.getElementById("rec-video-btn").onclick = () => startRecording("video");
    document.getElementById("rec-audio-btn").onclick = () => startRecording("audio");
    document.getElementById("rec-snap-btn").onclick = () => startSnapPhoto();
  }

  async function startRecording(type) {
    if (mediaRecorder || mediaStream) return;
    recordType = type;
    try {
      const constraints = type === "video"
        ? { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: _cameraFacing }, audio: true }
        : { audio: true };
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const mime = type === "video"
        ? (MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm")
        : "audio/webm";
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });

      // Show video preview for camera recording
      if (type === "video") {
        const preview = document.getElementById("rec-preview");
        if (preview) { preview.srcObject = mediaStream; preview.style.display = "block"; }
      }

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        // Hide preview
        const prev = document.getElementById("rec-preview");
        if (prev) { prev.srcObject = null; prev.style.display = "none"; }
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null; mediaRecorder = null;
        if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
        const blob = new Blob(recordedChunks, { type: mime });
        recordBlob = blob;
        // Show preview and update status
        const status = document.getElementById("rec-status");
        if (status) {
          status.style.display = "flex";
          status.innerHTML = `<span style="color:#16a34a;">✅ Recorded ${formatTime(Date.now() - recordStartTime)}</span><button type="button" id="rec-discard" style="padding:2px 6px;border:1px solid #dc2626;color:#dc2626;background:none;border-radius:3px;cursor:pointer;font-size:11px;">Discard</button>`;
          document.getElementById("rec-discard").onclick = () => { recordBlob = null; recordedChunks = []; status.style.display = "none"; updateRecButtons(); };
        }
        updateRecButtons();
      };
      mediaRecorder.start(1000);
      recordStartTime = Date.now();
      // Update UI
      updateRecButtons();
      const status = document.getElementById("rec-status");
      if (status) {
        status.style.display = "flex";
        const switchBtn = type === "video" ? `<button type="button" id="rec-switch-cam" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">🔄</button>` : "";
        status.innerHTML = `<span style="color:#dc2626;">⏺ Recording... ${formatTime(0)}</span>${switchBtn}<button type="button" id="rec-stop" style="padding:2px 8px;border:none;background:#dc2626;color:white;border-radius:3px;cursor:pointer;font-size:11px;">⏹ Stop</button>`;
        if (type === "video") document.getElementById("rec-switch-cam").onclick = () => switchCamera();
        document.getElementById("rec-stop").onclick = () => { if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop(); };
        recordTimer = setInterval(() => {
          const elapsed = Date.now() - recordStartTime;
          const s = status.querySelector("span");
          if (s) s.textContent = `⏺ Recording... ${formatTime(elapsed)}`;
          // Auto-stop at 3min for video, 5min for audio
          const max = type === "video" ? 180000 : 300000;
          if (elapsed >= max && mediaRecorder?.state === "recording") { mediaRecorder.stop(); toast("Recording limit reached", "#f97316"); }
        }, 500);
      }
      document.getElementById("pin-media").style.display = "none";
    } catch (err) {
      toast(type === "video" ? "Camera/mic access denied" : "Microphone access denied", "#dc2626");
      recordType = null;
    }
  }

  function updateRecButtons() {
    const vb = document.getElementById("rec-video-btn"), ab = document.getElementById("rec-audio-btn"), sb = document.getElementById("rec-snap-btn");
    if (!vb || !ab) return;
    const busy = !!mediaRecorder || !!recordBlob;
    vb.disabled = busy; ab.disabled = busy; if (sb) sb.disabled = busy;
    vb.style.opacity = busy ? "0.4" : "1";
    ab.style.opacity = busy ? "0.4" : "1";
    if (sb) sb.style.opacity = busy ? "0.4" : "1";
  }

  async function startSnapPhoto() {
    recordType = "snap";
    if (mediaRecorder || mediaStream || recordBlob) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: _cameraFacing } });
      const preview = document.getElementById("rec-preview");
      if (preview) { preview.srcObject = mediaStream; preview.style.display = "block"; }
      updateRecButtons();
      // Replace status with capture + cancel buttons
      const status = document.getElementById("rec-status");
      if (status) {
        status.style.display = "flex";
        status.innerHTML = `<button type="button" id="rec-capture" style="padding:4px 12px;border:none;background:#7c3aed;color:white;border-radius:4px;cursor:pointer;font-size:12px;">📸 Capture</button><button type="button" id="rec-switch-cam-snap" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">🔄</button><button type="button" id="rec-cancel-snap" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:11px;">Cancel</button>`;
        document.getElementById("rec-switch-cam-snap").onclick = () => switchCamera();
        const cleanupSnap = () => {
          if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
          if (preview) { preview.srcObject = null; preview.style.display = "none"; }
          status.style.display = "none";
          updateRecButtons();
        };
        document.getElementById("rec-cancel-snap").onclick = cleanupSnap;
        document.getElementById("rec-capture").onclick = () => {
          if (!preview || !mediaStream) return;
          const canvas = document.createElement("canvas");
          canvas.width = preview.videoWidth || 640;
          canvas.height = preview.videoHeight || 480;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) { toast("Snapshot failed", "#dc2626"); cleanupSnap(); return; }
            recordBlob = blob;
            cleanupSnap();
            if (status) {
              status.style.display = "flex";
              status.innerHTML = `<span style="color:#16a34a;">📸 Photo captured</span><button type="button" id="rec-discard" style="padding:2px 6px;border:1px solid #dc2626;color:#dc2626;background:none;border-radius:3px;cursor:pointer;font-size:11px;">Discard</button>`;
              document.getElementById("rec-discard").onclick = () => { recordBlob = null; status.style.display = "none"; updateRecButtons(); };
            }
          }, "image/jpeg", 0.85);
        };
      }
      document.getElementById("pin-media").style.display = "none";
    } catch (err) {
      toast("Camera access denied", "#dc2626");
    }
  }

  createRecordingUI();
  const clean = () => {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    mediaRecorder = null; recordBlob = null; recordedChunks = [];
    ov.remove();
  };
  document.getElementById("pin-cancel").onclick = clean;
  ov.onclick = (e) => {
    if (e.target === ov) clean();
  };
  document.getElementById("pin-title").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("pin-save").click();
  });
  const picker = document.getElementById("pin-color-picker");
  wireColorPicker("pin-color-picker", "pin-color", "pin-hex", COLORS);

  // Schema fields — render from selected schema
  document.getElementById("pin-schema").addEventListener("change", () => {
    const sid = document.getElementById("pin-schema").value;
    renderSchemaFieldsById(sid || null, "schema-fields", null);
  });

  // Sync schema dropdown when layer changes
  document.getElementById("pin-layer").addEventListener("change", () => {
    const lid = document.getElementById("pin-layer").value;
    const layer = state.layers.find(l => l.layer_id === lid);
    const sid = layer?.default_schema_id || "";
    document.getElementById("pin-schema").value = sid;
    renderSchemaFieldsById(sid || null, "schema-fields", null);
  });

  // Initial render based on default schema
  if (defaultSchemaId) {
    renderSchemaFieldsById(defaultSchemaId, "schema-fields", null);
  }

  const pinEmojiBtn = document.getElementById("pin-emoji-btn");
  const pinEmojiInput = document.getElementById("pin-emoji");
  pinEmojiBtn.onclick = () => {
    pinEmojiInput.focus();
    document.execCommand?.("insertText", false, "😊");
  };
  document.getElementById("pin-save").onclick = async () => {
    const t = document.getElementById("pin-title").value.trim(),
      n = document.getElementById("pin-note").value.trim();
    const color = document.getElementById("pin-color").value;
    const emoji = document.getElementById("pin-emoji").value.trim();
    const layerId = document.getElementById("pin-layer").value;
    const schemaData = collectSchemaData("schema-fields");
    const schemaId = document.getElementById("pin-schema").value || null;
    const validFrom = document.getElementById("pin-time-from").value;
    const validUntil = document.getElementById("pin-time-to").value;
    const file = document.getElementById("pin-media").files[0];
    let media = null;
    const sourceFile = file || (recordBlob ? new File([recordBlob], `recording-${Date.now()}.webm`, { type: recordBlob.type }) : null);
    if (sourceFile) {
      await checkStorageQuota(sourceFile.size, "attachment");
      const c = await compressMedia(sourceFile);
      const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
      media = {
        type: c.type,
        name: c.name,
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
      };
    }
    // Clean up recorder
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
    mediaRecorder = null; recordBlob = null; recordedChunks = [];
    clean();
    const postedAnonymously = document.getElementById("pin-anonymous")?.checked || false;
    await savePin(lat, lng, t || "Untitled", n, color, media, emoji, layerId, schemaId, schemaData, validFrom, validUntil, postedAnonymously);
  };
}

export function addDrawControl() {
  if (window._isEmbed) return;
  const toolbar = L.DomUtil.create("div");
  toolbar.style.cssText =
    "position:absolute;top:175px;right:8px;z-index:1000;display:flex;flex-direction:column;gap:2px;";
  const shapeOpts = { color: "#2563eb", weight: 2, fillOpacity: 0.15 };
  const svgLine =
    '<svg width="16" height="16" viewBox="0 0 16 16"><polyline points="2,14 6,6 10,10 14,2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svgPoly =
    '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2L14 6L12 12L4 12L2 6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const svgRect =
    '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" stroke-width="1.5" rx="1"/></svg>';
  const svgCirc =
    '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const toolDefs = [
    {
      title: `${t("polyline")}`,
      svg: svgLine,
      create: () => new L.Draw.Polyline(state.map, { shapeOptions: shapeOpts }),
    },
    {
      title: `${t("polygon")}`,
      svg: svgPoly,
      create: () =>
        new L.Draw.Polygon(state.map, {
          shapeOptions: shapeOpts,
          allowIntersection: false,
          showArea: true,
        }),
    },
    {
      title: `${t("rectangle")}`,
      svg: svgRect,
      create: () =>
        new L.Draw.Rectangle(state.map, { shapeOptions: shapeOpts }),
    },
    {
      title: `${t("circle")}`,
      svg: svgCirc,
      create: () => new L.Draw.Circle(state.map, { shapeOptions: shapeOpts }),
    },
  ];
  let activeBtn = null;
  let activeHandler = null;
  function resetActive() {
    if (activeHandler) {
      activeHandler.disable();
      activeHandler = null;
    }
    if (activeBtn) {
      activeBtn.style.background = "white";
      activeBtn.style.color = "#374151";
      activeBtn = null;
    }
  }
  toolDefs.forEach((def) => {
    const btn = L.DomUtil.create("button");
    btn.title = def.title;
    btn.innerHTML = def.svg;
    btn.style.cssText =
      "width:36px;height:36px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);color:var(--text);cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;padding:0;";
    btn.onclick = (e) => {
      e.stopPropagation();
      if (activeBtn === btn) {
        resetActive();
        return;
      }
      resetActive();
      activeBtn = btn;
      btn.style.background = "#2563eb";
      btn.style.color = "white";
      activeHandler = def.create();
      activeHandler.enable();
    };
    toolbar.appendChild(btn);
  });
  state.map.getContainer().appendChild(toolbar);
  state.map.on(L.Draw.Event.CREATED, (e) => {
    resetActive();
    const l = e.layer,
      g = l.toGeoJSON();
    if (l instanceof L.Circle) {
      g.properties = g.properties || {};
      g.properties.radius = l.getRadius();
    }
    showDrawingForm(g);
  });
  state.map.on(L.Draw.Event.DRAWSTOP, () => resetActive());
}

export function geoJsonToLayer(g) {
  if (g.type === "FeatureCollection") {
    const group = L.featureGroup();
    for (const feature of g.features) {
      group.addLayer(geoJsonToLayer(feature));
    }
    return group;
  }
  const c = g.properties?.color || "#2563eb";
  if (g.geometry.type === "Point" && g.properties?.radius) {
    const [lng, lat] = g.geometry.coordinates;
    return L.circle([lat, lng], {
      radius: g.properties.radius,
      color: c,
      weight: 2,
      fillOpacity: 0.15,
    });
  }
  const layer = L.geoJSON(g, {
    style: { color: c, weight: g.properties?.["stroke-width"] || 2, opacity: g.properties?.["stroke-opacity"] ?? 1, fillOpacity: 0.15 },
  });
  if (g.properties?.arrow && g.geometry.type === "LineString") {
    layer.on("add", function () {
      const coords = g.geometry.coordinates;
      if (coords && coords.length >= 2) {
        const last = coords[coords.length - 1],
          prev = coords[coords.length - 2];
        const angle =
          (Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180) / Math.PI;
        const arrow = L.marker([last[1], last[0]], {
          icon: L.divIcon({
            className: "arrowhead",
            html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:12px solid ${c};transform:rotate(${angle - 90}deg);"></div>`,
            iconSize: [10, 12],
            iconAnchor: [5, 6],
          }),
        });
        arrow.addTo(state.map);
        layer._arrowhead = arrow;
      }
    });
    layer.remove = function () {
      if (layer._arrowhead) state.map.removeLayer(layer._arrowhead);
      return L.Layer.prototype.remove.call(this);
    };
  }
  return layer;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let _metricMode = localStorage.getItem("pins-metric") !== "0";

function persistMetric() {
  localStorage.setItem("pins-metric", _metricMode ? "1" : "0");
}

export function toggleMetricMode() {
  _metricMode = !_metricMode;
  persistMetric();
}

export function isMetricMode() {
  return _metricMode;
}

function fmt(n, dec) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: dec }).format(n);
}

function fmtDist(m) {
  if (_metricMode) {
    return m >= 1000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m, 0)} m`;
  }
  const mi = m / 1609.344;
  const yd = m / 0.9144;
  return mi >= 1 ? `${fmt(mi, 2)} mi` : `${fmt(yd, 0)} yd`;
}

function fmtArea(sqM) {
  if (_metricMode) {
    return sqM >= 1e6 ? `${fmt(sqM / 1e6, 1)} km²` : `${fmt(sqM, 0)} m²`;
  }
  const sqMi = sqM / 2.59e6;
  const sqYd = sqM * 1.19599;
  return sqMi >= 1 ? `${fmt(sqMi, 2)} mi²` : `${fmt(sqYd, 0)} yd²`;
}

function toggleLink() {
  return ` <a href="#" class="metric-toggle" style="font-size:10px;color:var(--text-dim);text-decoration:none;white-space:nowrap;">(${_metricMode ? "show 🦶" : "show m"})</a>`;
}

function geodesicArea(coords) {
  const R = 6371000;
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lng1 = (coords[i][0] * Math.PI) / 180;
    const lat1 = (coords[i][1] * Math.PI) / 180;
    const lng2 = (coords[j][0] * Math.PI) / 180;
    const lat2 = (coords[j][1] * Math.PI) / 180;
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((area * R * R) / 2);
}

export function geomMetrics(g) {
  const json = encodeURIComponent(JSON.stringify(g));
  const tl = toggleLink();
  let html = "";
  if (g.type === "FeatureCollection") {
    const { length: totalM } = JSON.parse(compute_geometry(JSON.stringify(g)));
    if (totalM > 0) html = `<b>${t("length")}:</b> ${fmtDist(totalM)}&nbsp;${tl}`;
  }
  const type = g.geometry?.type;
  if (type === "Point" && g.properties?.radius) {
    const r = g.properties.radius;
    const circ = 2 * Math.PI * r;
    const area = Math.PI * r * r;
    html = `<b>${t("circumference")}:</b> ${fmtDist(circ)}<br><b>${t("diameter")}:</b> ${fmtDist(r * 2)}<br><b>${t("area")}:</b> ${fmtArea(area)}&nbsp;${tl}`;
  } else if (type === "LineString") {
    const { length: totalM } = JSON.parse(compute_geometry(JSON.stringify(g)));
    if (totalM > 0) html = `<b>${t("length")}:</b> ${fmtDist(totalM)}&nbsp;${tl}`;
  } else if (type === "Polygon") {
    const { perimeter: totalM, area } = JSON.parse(compute_geometry(JSON.stringify(g)));
    html = `<b>${t("perimeter")}:</b> ${fmtDist(totalM)}<br><b>${t("area")}:</b> ${fmtArea(area)}&nbsp;${tl}`;
  }
  return html
    ? `<span class="metrics-box" data-json="${json}">${html}</span>`
    : "";
}

export async function saveDrawing(g, mediaObj, layerId) {
  if (!state.dek || !state.currentSet) return;
  const did = generate_uuid();
  g.id = did;
  const enc = encrypt_geojson(JSON.stringify(g), state.dek);
  const d = {
    drawing_id: did,
    team_id: state.currentSet,
    layer_id: layerId || (state.layers[0] ? state.layers[0].layer_id : null),
    encrypted_geojson: enc.ciphertext,
    nonce: enc.nonce,
  };
  if (state.signingPublicKey) d.author_pubkey = state.signingPublicKey;
  if (mediaObj) d.media = mediaObj;
  await DB.saveDrawing(d);
  pushUndo({ kind: "drawing", type: "save", drawing: d, did });
  window._broadcast?.("new_drawing", d);
  await loadDrawings();
  window._addHistory?.(t("drawingAdded"), g.properties?.title || "Untitled");
  playSave();
}

export function buildDrawingPopup(g, row, layer, opacity) {
  const title = escapeHtml(g.properties?.title || "Drawing"),
    n = escapeHtml(g.properties?.note || "");
  const metrics = geomMetrics(g);
  const mins = metrics
    ? `<div style="margin-top:4px;padding:4px 6px;background:#f0fdf4;border:1px solid #86efac;border-radius:3px;font-size:11px;color:#166534;">${metrics}</div>`
    : "";
  let mh = "";
  if (row && row.media) {
    try {
      const mt = row.media.type;
      let tag = null;
      if (
        mt === "image/png" ||
        mt === "image/jpeg" ||
        mt === "image/gif" ||
        mt === "image/webp"
      )
        tag = "img";
      else if (mt === "video/mp4" || mt === "video/webm") tag = "video";
      if (tag) {
        const dec = decrypt_raw_bytes(
          row.media.ciphertext,
          row.media.nonce,
          state.dek,
        );
        const blob = new Blob([dec], { type: mt });
        const url = URL.createObjectURL(blob);
        if (tag === "img")
          mh = `<br><img src="${url}" style="max-width:200px;max-height:150px;margin-top:4px;">`;
        else
          mh = `<br><video src="${url}" controls style="max-width:200px;max-height:150px;margin-top:4px;"></video>`;
      } else {
        mh = `<br><a href="#" class="dwg-attachment" data-did="${escapeHtml(row.drawing_id)}" style="font-size:12px;">${escapeHtml(row.media.name || t("attachment"))}</a>`;
      }
    } catch (_) {}
  }
  const did = row ? escapeHtml(row.drawing_id) : "";
  const layerBadge = (layer && layer.layer_id)
    ? `<span class="layer-badge" style="border-color:${layer.color};">📑 ${escapeHtml(layer.name)}</span><br>`
    : "";
  const isEmbed = window._isEmbed || false;
  const isOwner = row?.author_pubkey && row.author_pubkey === state.signingPublicKey;
  const myRole = state.myRole;
  const canModerate = myRole === "maintainer" || myRole === "founder";
  const canEdit = !isEmbed && (isOwner || canModerate) && myRole !== "reader";
  const canDelete = !isEmbed && (isOwner || canModerate) && myRole !== "reader";
  const editBtns = (!canEdit && !canDelete) ? "" : `${canEdit ? `<button class="edit-dwg-btn" data-did="${did}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">${t("edit")}</button>` : ""}${canDelete ? `<button class="delete-dwg-btn" data-did="${did}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">${t("delete")}</button>` : ""}`;
  return `<b>${title}</b><br>${n}${mins}${mh}<br>${layerBadge}${editBtns}`;
}

export async function loadDrawings() {
  if (!state.dek || !state.currentSet) return;
  if (state.layers.length === 0) await loadLayersForSet(state.currentSet);

  state.drawingLayers.forEach((l) => state.map.removeLayer(l));
  state.drawingLayers.length = 0;

  const layerMap = new Map(state.layers.map(l => [l.layer_id, l]));
  const defaultLayer = state.layers[0];

  for (const row of await DB.getDrawings(state.currentSet)) {
    try {
      const g = JSON.parse(
        decrypt_geojson(row.encrypted_geojson, row.nonce, state.dek),
      );
      const layerId = row.layer_id || (defaultLayer ? defaultLayer.layer_id : null);
      const layer = layerId ? layerMap.get(layerId) : defaultLayer;
      const opacity = layer && layer.visible ? layer.opacity : 0;

      const drawLayer = geoJsonToLayer(g).addTo(state.map);
      drawLayer.setStyle({ opacity, fillOpacity: opacity * 0.15 });
      state.drawingLayers.push(drawLayer);
      drawLayer._geojson = g;
      drawLayer._row = row;
      drawLayer._layerId = layerId;
      drawLayer._validFrom = row.valid_from !== undefined ? row.valid_from : null;
      drawLayer._validTo = row.valid_until !== undefined ? row.valid_until : null;
      drawLayer.bindPopup(buildDrawingPopup(g, row, layer, opacity));
    } catch (_) {}
  }
  applyTimeFilter();
}

export async function loadChains() {
  if (!state.currentSet) return;
  state.chainLayers.forEach(l => state.map.removeLayer(l));
  state.chainLayers.length = 0;
  const chains = await DB.getChainsByCommunity(state.currentSet) || [];
  for (const c of chains) {
    try {
      const coords = [];
      for (const pid of (c.pin_ids || [])) {
        const m = state.markers.find(mk => mk._pinId === pid);
        if (m) coords.push(m.getLatLng());
      }
      if (coords.length < 2) continue;
      const poly = L.polyline(coords, {
        color: "#2563eb",
        weight: 3,
        dashArray: "8 4",
        interactive: true,
      }).addTo(state.map);
      poly._chainId = c.chain_id;
      poly._chainName = c.name;
      poly._chainPinIds = c.pin_ids;
      poly.bindPopup(`<b>${escapeHtml(c.name)}</b><br><span style="font-size:11px;color:var(--text-dim);">${coords.length} pins</span>
        <br><button class="chain-popup-walk" data-cid="${escapeHtml(c.chain_id)}" style="margin-top:4px;padding:3px 10px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:11px;">▶ Walk</button>
        <button class="chain-popup-delete" data-cid="${escapeHtml(c.chain_id)}" style="margin-top:4px;margin-left:4px;padding:3px 10px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">× Delete</button>`);
      poly.on("popupopen", () => {
        const el = poly.getPopup()?.getElement();
        const walkBtn = el?.querySelector(".chain-popup-walk");
        const delBtn = el?.querySelector(".chain-popup-delete");
        if (walkBtn) walkBtn.onclick = () => { renderChain(c.chain_id); };
        if (delBtn) delBtn.onclick = async () => {
          if (!await confirmDialog("Delete this chain?")) return;
          await DB.deleteChain(c.chain_id);
          poly.remove();
          state.chainLayers = state.chainLayers.filter(cl => cl._chainId !== c.chain_id);
          toast("Chain deleted", "#f97316");
        };
      });
      state.chainLayers.push(poly);
    } catch (_) {}
  }
}

export async function loadSubscribedPins() {
  state.subscribedMarkers.forEach(m => m.remove());
  state.subscribedMarkers.length = 0;
  state.subscribedDrawingLayers.forEach(l => state.map.removeLayer(l));
  state.subscribedDrawingLayers.length = 0;

  const subs = await DB.getAllSubscribedLayers();
  if (!subs || subs.length === 0) return;

  state._subscribedCache = state._subscribedCache || new Map();
  const fetchedCommunities = new Set();

  for (const sub of subs) {
    const dekKey = `${sub.source_community_id}:${sub.source_layer_id}`;
    const dek = state.subscribedDEKs.get(dekKey);
    if (!dek) continue;

    let pins = null;
    if (fetchedCommunities.has(sub.source_community_id)) {
      pins = state._subscribedCache.get(`pins:${sub.source_community_id}`);
    } else {
      try {
        pins = await DB.getPins(sub.source_community_id);
        state._subscribedCache.set(`pins:${sub.source_community_id}`, pins);
        fetchedCommunities.add(sub.source_community_id);
      } catch (_) { continue; }
    }

    if (!pins) continue;

    for (const row of pins) {
      try {
        let pin;
        const cacheKey = `dec:${sub.source_community_id}:${row.pin_id}`;
        const cached = state._subscribedCache.get(cacheKey);
        if (cached && cached.ciphertext === row.ciphertext) {
          pin = cached.pin;
        } else {
          pin = decrypt_pin_data(row.ciphertext, row.nonce, dek);
          state._subscribedCache.set(cacheKey, { pin, ciphertext: row.ciphertext });
        }
        pin.pin_id = row.pin_id;
          const marker = L.marker([pin.lat, pin.lng], {
            icon: pinIcon(pin.color || "#7c3aed"),
            opacity: 0.7,
          });
          marker._pinTitle = pin.title || "Untitled";
          marker._pinData = pin;
          marker._pinId = row.pin_id;
          marker._pinColor = pin.color || "#7c3aed";
          marker._pinCreatedAt = row.created_at;
          marker._authorPubkey = row.author_pubkey;
          marker._postedAnonymously = row.posted_anonymously;
          marker._sourceCommunityId = sub.source_community_id;
          marker._sourceCommunityName = sub.source_community_name;
          marker._sourceLayerName = sub.source_layer_name;
          marker.bindPopup(`<b>${escapeHtml(pin.title || "Untitled")}</b><br>${escapeHtml((pin.note || "").slice(0, 200))}<br><small style="color:var(--text-dim);">Via ${escapeHtml(sub.source_community_name)} / ${escapeHtml(sub.source_layer_name)}</small>`);
          marker.addTo(state.map);
          state.subscribedMarkers.push(marker);
        } catch (err) { console.warn("[loadSubscribed] pin render failed:", err.message); }
      }

    // Load drawings
    try {
      let drawings = state._subscribedCache.get(`drawings:${sub.source_community_id}`);
      if (drawings === undefined) {
        drawings = await DB.getDrawings(sub.source_community_id);
        state._subscribedCache.set(`drawings:${sub.source_community_id}`, drawings);
      }
      if (!drawings) continue;
      for (const row of drawings) {
        try {
          const geo = decrypt_geojson(row.ciphertext, row.nonce, dek);
          if (!geo) continue;
          const drawLayer = L.geoJSON(geo, {
            style: () => ({ color: "#7c3aed", opacity: 0.6, fillOpacity: 0.1 }),
          });
          drawLayer._drawingId = row.drawing_id;
          drawLayer._sourceCommunityId = sub.source_community_id;
          drawLayer._sourceCommunityName = sub.source_community_name;
          drawLayer.addTo(state.map);
          state.subscribedDrawingLayers.push(drawLayer);
        } catch (err) { console.warn("[loadSubscribed] drawing render failed:", err.message); }
      }
    } catch (_) {}
  }
}

export async function deleteDrawing(did) {
  const drawings = await DB.getDrawings(state.currentSet);
  const row = drawings.find((d) => d.drawing_id === did);
  if (row) pushUndo({ kind: "drawing", type: "delete", drawing: row, did });
  await DB.deleteDrawing(did);
  window._broadcast?.("delete_drawing", { drawing_id: did });
  await loadDrawings();
  window._addHistory?.(t("drawingDeleted"), did.slice(0, 8));
}

export function showEditDrawingForm(did) {
  if (!state.dek || !state.currentSet) return;
  DB.getDrawings(state.currentSet)
    .then((drawings) => {
      const row = drawings.find((d) => d.drawing_id === did);
      if (!row) return;
      try {
        const g = JSON.parse(
          decrypt_geojson(row.encrypted_geojson, row.nonce, state.dek),
        );
        const ov = document.createElement("div");
        ov.style.cssText =
          "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
        const curColor = g.properties?.color || "#2563eb";
        const curArrow = g.properties?.arrow ? "checked" : "";
        const colorCircles = colorPresetsHTML(COLORS, curColor);
        ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("editDrawing")}</h3><input id="edit-dwg-title" placeholder="${t("title")}" value="${escapeHtml(g.properties?.title || "")}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" /><textarea id="edit-dwg-note" placeholder="${t("description")}" rows="3" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;resize:vertical;">${escapeHtml(g.properties?.note || "")}</textarea><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("color")}</div><div id="edit-dwg-color-picker" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;">${colorCircles}</div><input type="hidden" id="edit-dwg-color" value="${escapeHtml(curColor)}" /><label style="display:flex;align-items:center;gap:4px;font-size:12px;margin-bottom:12px;"><input type="checkbox" id="edit-dwg-arrow" ${curArrow} /> ${t("arrow")}</label><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="edit-dwg-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="edit-dwg-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
        document.body.appendChild(ov);
        document.getElementById("edit-dwg-title").focus();
        const clean = () => ov.remove();
        document.getElementById("edit-dwg-cancel").onclick = clean;
        ov.onclick = (e) => {
          if (e.target === ov) clean();
        };
        document
          .getElementById("edit-dwg-title")
          .addEventListener("keydown", (e) => {
            if (e.key === "Enter")
              document.getElementById("edit-dwg-save").click();
          });
        const picker = document.getElementById("edit-dwg-color-picker");
        picker.querySelectorAll(".color-preset").forEach((c) => {
          c.onclick = () => {
            document.getElementById("edit-dwg-color").value = c.dataset.color;
            picker
              .querySelectorAll(".color-preset")
              .forEach((s) => (s.style.border = "2px solid transparent"));
            c.style.border = "2px solid #111";
          };
        });
        document.getElementById("edit-dwg-save").onclick = async () => {
          const t = document.getElementById("edit-dwg-title").value.trim();
          const n = document.getElementById("edit-dwg-note").value.trim();
          const color = document.getElementById("edit-dwg-color").value;
          const arrow = document.getElementById("edit-dwg-arrow").checked;
          clean();
          await updateDrawing(row, t || "Drawing", n, color, arrow);
          state.map.closePopup();
        };
      } catch (_) {}
    })
    .catch(() => {});
}

async function updateDrawing(row, title, note, color, arrow) {
  if (!state.dek || !state.currentSet) return;
  try {
    const g = JSON.parse(
      decrypt_geojson(row.encrypted_geojson, row.nonce, state.dek),
    );
    g.properties = g.properties || {};
    g.properties.title = title;
    g.properties.note = note;
    g.properties.color = color;
    g.properties.arrow = arrow;
    const enc = encrypt_geojson(JSON.stringify(g), state.dek);
    row.encrypted_geojson = enc.ciphertext;
    row.nonce = enc.nonce;
    await DB.saveDrawing(row);
    window._broadcast?.("new_drawing", row);
    await loadDrawings();
    window._addHistory?.(t("drawingEdited"), title);
  } catch (_) {}
}

export async function downloadDrawingAttachment(did) {
  if (!state.dek) return;
  try {
    const drawings = await DB.getDrawings(state.currentSet);
    const row = drawings.find((d) => d.drawing_id === did);
    if (!row || !row.media) return;
    const dec = decrypt_raw_bytes(
      row.media.ciphertext,
      row.media.nonce,
      state.dek,
    );
    const blob = new Blob([dec], {
      type: row.media.type || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = row.media.name || "attachment";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (_) {}
}

export function addPinButton() {
  const isEmbed = window._isEmbed || false;

  if (!window._drawerActive) {
    const searchInput = L.DomUtil.create("input");
  searchInput.type = "text";
  searchInput.id = "filter-input";
  searchInput.placeholder = `${t("filterPins")}`;
  searchInput.style.cssText =
    "position:absolute;top:80px;left:50%;transform:translateX(-50%);z-index:1000;width:200px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:14px;box-shadow:0 1px 5px rgba(0,0,0,0.15);";
  searchInput.oninput = () => {
    const q = searchInput.value.toLowerCase().trim();
    for (let i = 0; i < state.markers.length; i++) {
      const match =
        !q || (state.pinSearchText[i] && state.pinSearchText[i].includes(q));
      state.markers[i].setOpacity(match ? 1 : 0.15);
    }
  };
  state.map.getContainer().appendChild(searchInput);

  const osmSearch = L.DomUtil.create("input");
  osmSearch.type = "text";
  osmSearch.id = "osm-search";
  osmSearch.placeholder = `${t("searchPlaces")}`;
  osmSearch.style.cssText =
    "position:absolute;top:40px;left:50%;transform:translateX(-50%);z-index:1000;width:200px;padding:6px 8px;border:1px solid #2563eb;border-radius:4px;font-size:14px;box-shadow:0 1px 5px rgba(0,0,0,0.15);";
  let searchTimer;
  let searchAbort = null;
  osmSearch.oninput = () => {
    clearTimeout(searchTimer);
    const q = osmSearch.value.trim();
    if (q.length < 3) return;
    searchTimer = setTimeout(async () => {
      const now = Date.now();
      if (now - (state._nominatimLastCall || 0) < 2000) return;
      state._nominatimLastCall = now;
      if (searchAbort) searchAbort.abort();
      searchAbort = new AbortController();
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`,
          { signal: searchAbort.signal },
        );
        const results = await resp.json();
        if (!results.length) return;
        const bbox = results[0].boundingbox;
        if (bbox) {
          state.map.fitBounds([
            [bbox[0], bbox[2]],
            [bbox[1], bbox[3]],
          ]);
        } else {
          state.map.setView([results[0].lat, results[0].lon], 15);
        }
      } catch (e) { if (e.name !== "AbortError") console.warn("[osm] search failed:", e.message); }
    }, 750);
  };
  state.map.getContainer().appendChild(osmSearch);
  }

  if (isEmbed) return;

  if (!window._drawerActive) {
    const btn = L.DomUtil.create("button");
    btn.textContent = "📌";
    btn.title = `${t("createPin")}`;
    btn.style.cssText =
      "position:absolute;top:95px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:6px;background:var(--accent,#2563eb);color:white;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;transition:background 0.15s;";
    btn.onclick = (e) => {
      e.stopPropagation();
      state.placingPin = !state.placingPin;
      btn.textContent = state.placingPin ? "📍" : "📌";
      btn.style.background = state.placingPin
        ? "var(--accent-active,#1d4ed8)"
        : "var(--accent,#2563eb)";
      state.map.getContainer().style.cursor = state.placingPin ? "crosshair" : "";
    };
    state.map.getContainer().appendChild(btn);
  }

  if (!window._drawerActive) {
    const fsBtn = L.DomUtil.create("button");
    fsBtn.textContent = "⛶";
    fsBtn.title = `${t("fullscreen")}`;
    fsBtn.style.cssText =
      "position:absolute;top:108px;left:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:18px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
    fsBtn.onclick = () => {
      if (!document.fullscreenElement)
        document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    };
    if (!window.matchMedia("(display-mode: standalone)").matches) {
      state.map.getContainer().appendChild(fsBtn);
    }
  }

  if (!isEmbed && !window._drawerActive) {
    const svBtn = L.DomUtil.create("button");
    svBtn.textContent = "🚶";
    svBtn.title = `${t("streetView")}`;
    svBtn.style.cssText =
      "position:absolute;top:150px;left:8px;z-index:1000;width:32px;height:32px;border:none;border-radius:4px;background:#059669;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
    svBtn.onclick = (e) => {
      e.stopPropagation();
      state.streetViewing = !state.streetViewing;
      svBtn.style.background = state.streetViewing ? "#047857" : "#059669";
      state.map.getContainer().style.cursor = state.streetViewing
        ? "crosshair"
        : "";
    };
    state.map.getContainer().appendChild(svBtn);
  }
}

export function addFreeDrawButton() {
  if (window._isEmbed) return;
  initFreeDraw(showDrawingForm);
  _addFreeDraw();
}

export function addGridOverlay() {
  let enabled = false;
  let gridLayer = null;
  const btn = L.DomUtil.create("button", "leaflet-control");
  btn.textContent = "▦";
  btn.title = "Grid overlay";
  btn.style.cssText =
    "width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;margin-left:2px;";
  let _satelliteLayer = null;
  for (const key of Object.keys(state.map._layers || {})) {
    const l = state.map._layers[key];
    if (l._url && l._url.includes("ArcGIS")) { _satelliteLayer = l; break; }
  }

  function drawGrid() {
    if (gridLayer) state.map.removeLayer(gridLayer);
    const bounds = state.map.getBounds();
    const zoom = state.map.getZoom();
    let step;
    if (zoom <= 3) step = 10;
    else if (zoom <= 6) step = 5;
    else if (zoom <= 9) step = 1;
    else step = 0.1;
    const lines = [];
    const isSatellite = document.querySelector(".leaflet-control-layers-selector:checked + span")?.textContent?.toLowerCase().includes("satellite");
    const style = {
      color: isSatellite ? "white" : "var(--text)",
      weight: 1, opacity: isSatellite ? 0.35 : 0.25, dashArray: "6 4", interactive: false,
    };
    const south = Math.floor(bounds.getSouth() / step) * step;
    const north = Math.ceil(bounds.getNorth() / step) * step;
    for (let lat = south; lat <= north; lat += step)
      lines.push(L.polyline([[lat, bounds.getWest()], [lat, bounds.getEast()]], style));
    const west = Math.floor(bounds.getWest() / step) * step;
    const east = Math.ceil(bounds.getEast() / step) * step;
    for (let lng = west; lng <= east; lng += step)
      lines.push(L.polyline([[bounds.getSouth(), lng], [bounds.getNorth(), lng]], style));
    gridLayer = L.layerGroup(lines).addTo(state.map);
  }

  btn.onclick = (e) => {
    e.stopPropagation();
    enabled = !enabled;
    btn.style.background = enabled ? "#4b5563" : "#6b7280";
    if (enabled) {
      drawGrid();
      state.map.on("moveend zoomend baselayerchange", drawGrid);
    } else {
      if (gridLayer) state.map.removeLayer(gridLayer);
      gridLayer = null;
      state.map.off("moveend zoomend baselayerchange", drawGrid);
    }
  };
  const layersCtrl = state.map.getContainer().querySelector(".leaflet-control-layers");
  if (layersCtrl) layersCtrl.after(btn);
  else {
    btn.style.position = "absolute"; btn.style.top = "62px"; btn.style.left = "8px";
    state.map.getContainer().appendChild(btn);
  }
}

export function addMeasureButton() {
  const btn = L.DomUtil.create("button");
  btn.textContent = "📏";
  btn.title = "Measure distance";
  btn.style.cssText =
    "position:absolute;top:177px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#0891b2;color:white;font-size:18px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
  let pointA = null, measureLayer = null;
  function clearMeasureLayer() { if (measureLayer) { state.map.removeLayer(measureLayer); measureLayer = null; } }
  btn.onclick = (e) => {
    e.stopPropagation();
    state.measuring = !state.measuring;
    if (state.measuring) { btn.style.background = "#0e7490"; state.map.getContainer().style.cursor = "crosshair"; }
    else { btn.style.background = "#0891b2"; state.map.getContainer().style.cursor = ""; pointA = null; clearMeasureLayer(); }
  };
  state.map.getContainer().appendChild(btn);
  state.map.on("click", (e) => {
    if (!state.measuring || state.freeDrawing) return;
    const ll = e.latlng;
    if (!pointA) {
      pointA = ll; clearMeasureLayer();
      const marker = L.circleMarker([ll.lat, ll.lng], { radius: 5, color: "#0891b2", fillColor: "#0891b2", fillOpacity: 0.6, weight: 2 }).addTo(state.map);
      measureLayer = L.layerGroup([marker]).addTo(state.map);
    } else {
      clearMeasureLayer();
      const markerA = L.circleMarker([pointA.lat, pointA.lng], { radius: 5, color: "#0891b2", fillColor: "#0891b2", fillOpacity: 0.6, weight: 2 });
      const markerB = L.circleMarker([ll.lat, ll.lng], { radius: 5, color: "#0891b2", fillColor: "#0891b2", fillOpacity: 0.6, weight: 2 });
      const line = L.polyline([[pointA.lat, pointA.lng], [ll.lat, ll.lng]], { color: "#0891b2", weight: 2, dashArray: "6 4" });
      const dist = pointA.distanceTo(ll);
      const mainUnit = fmtDist(dist);
      const altUnit = _metricMode
        ? (dist >= 1609.344 ? `${fmt(dist / 1609.344, 2)} mi` : `${fmt(dist / 0.9144, 0)} yd`)
        : (dist >= 1000 ? `${fmt(dist / 1000, 1)} km` : `${fmt(dist, 0)} m`);
      const label = L.divIcon({
        className: "",
        html: `<div style="background:var(--bg-card);color:var(--text);padding:6px 12px;border-radius:8px;font-size:15px;font-weight:700;white-space:nowrap;box-shadow:0 2px 12px rgba(0,0,0,0.25);border:1px solid var(--border);text-align:center;line-height:1.4;">${mainUnit}<br><span style="font-size:11px;font-weight:400;color:var(--text-dim);">${altUnit}</span></div>`,
        iconSize: [140, 52], iconAnchor: [70, 26],
      });
      const mid = L.latLng((pointA.lat + ll.lat) / 2, (pointA.lng + ll.lng) / 2);
      const labelMarker = L.marker(mid, { icon: label });
      measureLayer = L.layerGroup([markerA, markerB, line, labelMarker]).addTo(state.map);
      pointA = null;
    }
  });
}

export function applyTimeFilter() {
  const hasFilter = state.timeFrom !== null || state.timeTo !== null;
  const hasTrustFilter = state.minTrustScore !== null && state.minTrustScore !== undefined;
  const now = new Date().getFullYear();
  for (const m of state.markers) {
    let visible = true;
    if (hasFilter) {
      const pf = m._validFrom, pt = m._validTo;
      if (pf !== null || pt !== null) {
        // If pf is 1-12 and pt is 1-12, treat as seasonal month range (recurring every year)
        if (pf !== null && pt !== null && pf >= 1 && pf <= 12 && pt >= 1 && pt <= 12) {
          // Seasonal pattern: pin is active if any year in the range has the seasonal window
          const tf = state.timeFrom ?? (state.timeTo ?? now - 10);
          const tt = state.timeTo ?? (state.timeFrom ?? now + 10);
          let yearVisible = false;
          for (let y = tf; y <= tt; y++) {
            const seasonStart = y + (pf < pt ? 0 : (pf > pt ? -1 : 0));
            if ((seasonStart >= tf - 1) && (y + 1 <= tt + 1)) yearVisible = true;
          }
          visible = yearVisible;
        } else {
          visible = (state.timeFrom === null || pt === null || pt >= state.timeFrom) && (state.timeTo === null || pf === null || pf <= state.timeTo);
        }
      }
    }
    if (hasTrustFilter && visible) {
      if (m._pinTrustLevel !== null) {
        const score = m._pinTrustScore ?? 0;
        if (score < state.minTrustScore) visible = false;
      }
    }
    m.setOpacity(visible ? (m._layerOpacity || 1) : 0);
  }
  for (const dl of state.drawingLayers) {
    let visible = true;
    if (hasFilter) {
      const pf = dl._validFrom, pt = dl._validTo;
      if (pf !== null || pt !== null) {
        if (pf !== null && pt !== null && pf >= 1 && pf <= 12 && pt >= 1 && pt <= 12) {
          const tf = state.timeFrom ?? (state.timeTo ?? now - 10);
          const tt = state.timeTo ?? (state.timeFrom ?? now + 10);
          let yearVisible = false;
          for (let y = tf; y <= tt; y++) {
            yearVisible = true; break;
          }
          visible = yearVisible;
        } else {
          visible = (state.timeFrom === null || pt === null || pt >= state.timeFrom) && (state.timeTo === null || pf === null || pf <= state.timeTo);
        }
      }
    }
    dl.setStyle({ opacity: visible ? 1 : 0, fillOpacity: visible ? 0.15 : 0, transition: "opacity 0.3s ease" });
  }
}

function readTimeInputs() {
  const fromEl = document.getElementById("time-from");
  const toEl = document.getElementById("time-to");
  state.timeFrom = fromEl?.value ? parseInt(fromEl.value) : null;
  state.timeTo = toEl?.value ? parseInt(toEl.value) : null;
}

export function addTimeSlider() {
  // Toggle button
  const btn = L.DomUtil.create("button");
  btn.textContent = "⏳";
  btn.title = "Time filter";
  btn.style.cssText = "position:absolute;top:290px;left:3px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
  state.map.getContainer().appendChild(btn);

  const container = L.DomUtil.create("div");
  container.id = "time-slider";
  container.style.cssText = "display:none;position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:1000;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:6px;box-shadow:0 1px 5px var(--shadow);font-size:12px;white-space:nowrap;";
  container.innerHTML = `
    <span style="color:var(--text-dim);">⏳</span>
    <input id="time-from" type="number" placeholder="-∞" style="width:70px;padding:3px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;text-align:center;" />
    <span style="color:var(--text-dim);">–</span>
    <input id="time-to" type="number" placeholder="∞" style="width:70px;padding:3px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;text-align:center;" />
    <button id="time-reset" style="padding:3px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;">reset</button>
    <button id="time-apply" style="padding:3px 8px;border:none;background:#2563eb;color:white;border-radius:3px;cursor:pointer;font-size:11px;">apply</button>
  `;
  state.map.getContainer().appendChild(container);

  let visible = false;
  btn.onclick = (e) => {
    e.stopPropagation();
    visible = !visible;
    container.style.display = visible ? "flex" : "none";
    btn.style.background = visible ? "#4b5563" : "#6b7280";
    if (visible) {
      if (state.timeFrom) document.getElementById("time-from").value = state.timeFrom;
      if (state.timeTo) document.getElementById("time-to").value = state.timeTo;
    } else {
      state.timeFrom = null; state.timeTo = null;
      document.getElementById("time-from").value = "";
      document.getElementById("time-to").value = "";
      applyTimeFilter();
    }
  };
  document.getElementById("time-reset").onclick = () => {
    document.getElementById("time-from").value = "";
    document.getElementById("time-to").value = "";
    state.timeFrom = null;
    state.timeTo = null;
    applyTimeFilter();
  };
  document.getElementById("time-apply").onclick = () => {
    readTimeInputs();
    applyTimeFilter();
  };
  document.getElementById("time-from").addEventListener("keydown", e => { if (e.key === "Enter") { readTimeInputs(); applyTimeFilter(); } });
  document.getElementById("time-to").addEventListener("keydown", e => { if (e.key === "Enter") { readTimeInputs(); applyTimeFilter(); } });
}

export function addTrustFilter() {
  const btn = L.DomUtil.create("button");
  btn.textContent = "🛡️";
  btn.title = "Trust filter";
  btn.style.cssText = "position:absolute;top:326px;left:3px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
  state.map.getContainer().appendChild(btn);

  const container = L.DomUtil.create("div");
  container.id = "trust-slider";
  container.style.cssText = "display:none;position:absolute;bottom:42px;left:50%;transform:translateX(-50%);z-index:1000;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:6px;box-shadow:0 1px 5px var(--shadow);font-size:12px;white-space:nowrap;";
  container.innerHTML = `
    <span style="color:var(--text-dim);">🛡️</span>
    <input id="trust-threshold" type="range" min="-20" max="20" value="-20" style="width:80px;accent-color:#16a34a;" />
    <span id="trust-val" style="font-size:10px;color:var(--text-dim);min-width:24px;">-2.0</span>
    <button id="trust-reset" style="padding:3px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;">reset</button>
  `;
  state.map.getContainer().appendChild(container);

  let visible = false;
  btn.onclick = (e) => {
    e.stopPropagation();
    visible = !visible;
    container.style.display = visible ? "flex" : "none";
    btn.style.background = visible ? "#4b5563" : "#6b7280";
    if (visible && state.minTrustScore) {
      document.getElementById("trust-threshold").value = state.minTrustScore * 10;
      document.getElementById("trust-val").textContent = state.minTrustScore.toFixed(1);
    }
    if (!visible) {
      state.minTrustScore = -2;
      applyTimeFilter();
    }
  };
  document.getElementById("trust-reset").onclick = () => {
    state.minTrustScore = -2;
    document.getElementById("trust-threshold").value = "-20";
    document.getElementById("trust-val").textContent = "-2.0";
    applyTimeFilter();
  };
  document.getElementById("trust-threshold").oninput = (e) => {
    const val = parseInt(e.target.value) / 10;
    state.minTrustScore = val;
    document.getElementById("trust-val").textContent = val.toFixed(1);
    applyTimeFilter();
  };
}

export function generateLocationMarker(lat, lng, communityId) {
  const c = state.currentCommunity;
  if (!c) { toast("No community active", "#dc2626"); return; }
  const nameBytes = new TextEncoder().encode(c.name || "");
  const cidBytes = hexToBytes((communityId || state.currentSet || "").replace(/-/g, ""));
  const relayUrl = c.relay_url || "";
  const relayBytes = relayUrl ? new TextEncoder().encode(relayUrl) : new Uint8Array(0);
  const flags = c.password_hash ? 1 : 0;
  const focusStr = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const focusBytes = new TextEncoder().encode(focusStr);
  const total = 1 + nameBytes.length + 16 + 1 + relayBytes.length + 1 + focusBytes.length;
  console.log("[gen-loc] encoding: total=", total, "nameLen=", nameBytes.length, "relayLen=", relayBytes.length, "focusLen=", focusBytes.length, "focusStr=", focusStr);
  const buf = new Uint8Array(total);
  let pos = 0;
  buf[pos++] = nameBytes.length;
  buf.set(nameBytes, pos); pos += nameBytes.length;
  buf.set(cidBytes, pos); pos += 16;
  buf[pos++] = relayBytes.length;
  if (relayBytes.length > 0) buf.set(relayBytes, pos);
  pos += relayBytes.length;
  buf[pos++] = flags;
  if (focusBytes.length > 0) buf.set(focusBytes, pos);
  const b64 = btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const link = window.location.origin + window.location.pathname + "#community=" + b64;

  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div style="background:white;padding:24px;border-radius:8px;max-width:360px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 8px;color:#111;">📍 Location Marker</h3>
    <p style="font-size:12px;color:#666;margin:0 0 12px;">Community: <b>${escapeHtml(c.name)}</b><br>Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}</p>
    <div id="loc-qr" style="margin-bottom:12px;"></div>
    <p style="font-size:10px;color:#888;margin:0 0 8px;">Print this and place it at the location. Scanning opens the community map centered here.</p>
    <button id="loc-print" style="padding:8px 16px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;">Print</button>
    <button id="loc-close" style="padding:8px 16px;border:1px solid #ccc;background:white;border-radius:4px;cursor:pointer;font-size:13px;margin-left:8px;">Close</button>
  </div>`;
  document.body.appendChild(ov);
  document.getElementById("loc-close").onclick = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  import("./core/pkg/e2e_core.js").then(mod => {
    const qrSvg = mod.generate_qr_svg(link);
    document.getElementById("loc-qr").innerHTML = qrSvg || "<p style='color:#dc2626;'>QR generation failed</p>";
  }).catch(() => {});
  document.getElementById("loc-print").onclick = () => {
    const w = window.open("", "_blank", "width=400,height=500");
    if (w) {
      w.document.write(`<html><body style="text-align:center;font-family:sans-serif;padding:20px;">${ov.querySelector("div").innerHTML}</body></html>`);
      w.document.close();
      w.print();
    }
  };
}

export function addChainTool() {
  const btn = L.DomUtil.create("button");
  btn.textContent = "🔗";
  btn.title = "Pin Chains";
  btn.style.cssText = "position:absolute;top:362px;left:3px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
  state.map.getContainer().appendChild(btn);

  btn.onclick = () => showChainsModal();
}

export async function showChainsModal() {
  const chains = await DB.getChainsByCommunity(state.currentSet) || [];
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:420px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">🔗 Chains</h3>
      <button id="chain-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div id="chain-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;">${
      chains.length > 0
        ? chains.map(c => {
          const cl = state.chainLayers.find(cl => cl._chainId === c.chain_id);
          const visible = cl ? cl._visible !== false : true;
          const eyeIcon = visible ? "👁" : "–";
          return `<div style="padding:8px;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:13px;">${escapeHtml(c.name)} <span style="font-size:10px;color:var(--text-dim);">${(c.pin_ids || []).length} pins</span></span>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="chain-eye-btn" data-cid="${escapeHtml(c.chain_id)}" style="padding:3px 7px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:12px;${visible ? "color:#16a34a;" : "color:var(--text-dim);"}">${eyeIcon}</button>
            <button class="chain-walk-btn" data-cid="${escapeHtml(c.chain_id)}" style="padding:3px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:11px;">▶ Walk</button>
            <button class="chain-del-btn" data-cid="${escapeHtml(c.chain_id)}" style="padding:3px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:13px;line-height:1;">×</button>
          </div>
        </div>`;
        }).join("")
        : '<div style="padding:12px;color:var(--text-dim);text-align:center;">No chains yet</div>'
    }</div>
    <button id="chain-new-btn" style="margin-top:8px;width:100%;padding:8px;border:1px dashed #2563eb;background:transparent;color:#2563eb;border-radius:4px;cursor:pointer;font-size:13px;">+ New Chain</button>
  </div>`;
  document.body.appendChild(ov);
  document.getElementById("chain-close").onclick = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  document.querySelectorAll(".chain-eye-btn").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const cl = state.chainLayers.find(cl => cl._chainId === b.dataset.cid);
      if (cl) {
        cl._visible = !(cl._visible !== false);
        if (cl._visible !== false) state.map.addLayer(cl);
        else state.map.removeLayer(cl);
      }
      const chains = await DB.getChainsByCommunity(state.currentSet) || [];
      const c = chains.find(c => c.chain_id === b.dataset.cid);
      const visible = cl ? cl._visible !== false : true;
      b.textContent = visible ? "👁" : "–";
      b.style.color = visible ? "#16a34a" : "var(--text-dim)";
    };
  });

  document.querySelectorAll(".chain-walk-btn").forEach(b => {
    b.onclick = async (e) => { e.stopPropagation(); ov.remove(); renderChain(b.dataset.cid); };
  });

  document.querySelectorAll(".chain-del-btn").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog("Delete this chain? Pins are not affected."))) return;
      await DB.deleteChain(b.dataset.cid);
      const cl = state.chainLayers.find(cl => cl._chainId === b.dataset.cid);
      if (cl) { state.map.removeLayer(cl); state.chainLayers = state.chainLayers.filter(cl2 => cl2._chainId !== b.dataset.cid); }
      ov.remove();
      showChainsModal();
      toast("Chain deleted", "#f97316");
    };
  });

  document.getElementById("chain-new-btn").onclick = async () => {
    const name = prompt("Chain name:");
    if (!name) return;
    ov.remove();
    startChainSelection(name);
  };
}

let _chainPins = [], _chainName = "";

function startChainSelection(name) {
  _chainPins = [];
  _chainName = name;
  const selMarkers = [];
  const clickBindings = [];
  const bar = document.createElement("div");
  bar.id = "chain-sel-bar";
  bar.style.cssText = "position:absolute;bottom:80px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;box-shadow:0 2px 14px rgba(0,0,0,0.18);z-index:1000;font-size:13px;white-space:nowrap;";
  bar.innerHTML = `<span style="color:var(--text-dim);font-weight:500;">🔗 ${escapeHtml(name)}: <span id="chain-count">0</span> pins</span><button id="chain-done" style="padding:4px 12px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:12px;">Save</button><button id="chain-cancel" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:11px;color:var(--text-dim);">Cancel</button>`;
  document.getElementById("map-container").appendChild(bar);

  const addMarker = (m) => {
    if (!m._pinId || _chainPins.includes(m._pinId)) return;
    _chainPins.push(m._pinId);
    const countEl = document.getElementById("chain-count");
    if (countEl) countEl.textContent = _chainPins.length;
    const ring = L.circleMarker(m.getLatLng(), {
      radius: 16,
      color: "#2563eb",
      fillColor: "transparent",
      weight: 3,
      interactive: false,
    }).addTo(state.map);
    selMarkers.push(ring);
  };

  // Wire per-marker click handlers to suppress popup
  for (const mk of state.markers) {
    const handler = (e) => {
      L.DomEvent.stop(e);
      addMarker(mk);
    };
    mk.on("click", handler);
    clickBindings.push({ mk, handler });
  }

  state.map.getContainer().style.cursor = "crosshair";

  const cleanup = () => {
    state.map.getContainer().style.cursor = "";
    document.getElementById("chain-sel-bar")?.remove();
    for (const { mk, handler } of clickBindings) mk.off("click", handler);
    clickBindings.length = 0;
    selMarkers.forEach(r => state.map.removeLayer(r));
    selMarkers.length = 0;
  };

  document.getElementById("chain-done").onclick = async () => {
    if (_chainPins.length < 2) { toast("Select at least 2 pins", "#f97316"); return; }
    await DB.saveChain({ chain_id: generate_uuid(), community_id: state.currentSet, name: _chainName, pin_ids: [..._chainPins], created_at: Date.now() });
    cleanup();
    await loadChains();
    toast("Chain saved: " + _chainName, "#16a34a");
  };
  document.getElementById("chain-cancel").onclick = () => { _chainPins = []; _chainName = ""; cleanup(); };
}

export async function renderChain(chainId) {
  const chain = await DB.getChain(chainId);
  if (!chain || !chain.pin_ids?.length) return;
  const coords = [];
  for (const pid of chain.pin_ids) {
    const m = state.markers.find(mk => mk._pinId === pid);
    if (m) coords.push(m.getLatLng());
  }
  if (coords.length < 2) return;
  const poly = L.polyline(coords, { color: "#2563eb", weight: 3, dashArray: "8 4" }).addTo(state.map);
  state.map.fitBounds(poly.getBounds().pad(0.2));
  // Fire slideshow — keep polyline visible so the chain is traceable during the fly-through
  startSlideshow(chain.pin_ids);
  // Remove polyline when slideshow popup closes (rough: after 30s timeout or on user interaction)
  setTimeout(() => { if (state.map.hasLayer(poly)) state.map.removeLayer(poly); }, 60000);
}

export function addSelectionTool() {
  let selecting = false, lassoMode = false, selStart = null, selRect = null, selPoly = null;
  let selectedPins = [], selectedDrawings = [], selBar = null;
  const btn = L.DomUtil.create("button");
  btn.textContent = "⊞";
  btn.title = "Select (right-click for lasso)";
  btn.style.cssText =
    "position:absolute;top:214px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";

  function clearSelLayer() { if (selRect) { state.map.removeLayer(selRect); selRect = null; } if (selPoly) { state.map.removeLayer(selPoly); selPoly = null; } }
  function clearSelection() {
    selectedPins.forEach((m) => { const icon = m._icon; if (icon) icon.style.filter = ""; });
    selectedDrawings.forEach((l) => { l.setStyle({ color: l._origColor || l.options?.color || "#2563eb" }); });
    selectedPins = []; selectedDrawings = []; if (selBar) { selBar.remove(); selBar = null; } clearSelLayer();
  }
  function showSelBar() {
    if (selBar) selBar.remove();
    const total = selectedPins.length + selectedDrawings.length;
    if (total === 0) return;
    selBar = document.createElement("div");
    selBar.style.cssText = "position:absolute;top:214px;right:48px;z-index:1001;display:flex;gap:4px;";
    const delBtn = document.createElement("button");
    delBtn.textContent = `${t("delete")} (${total})`;
    delBtn.style.cssText = "height:28px;border:none;border-radius:4px;background:#dc2626;color:white;cursor:pointer;font-size:12px;font-weight:600;padding:0 8px;white-space:nowrap;";
    delBtn.onclick = async () => {
      for (const m of selectedPins) await deletePin(m._pinId);
      for (const l of selectedDrawings) await deleteDrawing(l._drawingId || l._row?.drawing_id);
      clearSelection(); selecting = false; btn.style.background = "#6b7280"; state.map.getContainer().style.cursor = "";
    };
    selBar.appendChild(delBtn); state.map.getContainer().appendChild(selBar);
  }
  function selectionForBounds(bounds) {
    clearSelection();
    state.markers.forEach((m) => { if (bounds.contains(m.getLatLng())) { selectedPins.push(m); const icon = m._icon; if (icon) icon.style.filter = "drop-shadow(0 0 4px #2563eb) brightness(1.2)"; } });
    state.drawingLayers.forEach((l) => { try { const lb = l.getBounds(); if (lb && bounds.intersects(lb)) { selectedDrawings.push(l); l._origColor = l.options?.color || l._origColor; l.setStyle({ color: "#2563eb", weight: (l.options?.weight || 2) + 1 }); } } catch (_) {} });
    if (selectedPins.length + selectedDrawings.length > 0) showSelBar();
  }
  function selectionForPoly(latlngs) {
    clearSelection();
    const polyArr = latlngs.map((ll) => [ll.lng, ll.lat]);
    state.markers.forEach((m) => { const ll = m.getLatLng(); if (pointInPolygon([ll.lng, ll.lat], polyArr)) { selectedPins.push(m); const icon = m._icon; if (icon) icon.style.filter = "drop-shadow(0 0 4px #2563eb) brightness(1.2)"; } });
    state.drawingLayers.forEach((l) => { try { const lb = l.getBounds(); if (lb) { const c = lb.getCenter(); if (pointInPolygon([c.lng, c.lat], polyArr)) { selectedDrawings.push(l); l._origColor = l.options?.color || l._origColor; l.setStyle({ color: "#2563eb", weight: (l.options?.weight || 2) + 1 }); } } } catch (_) {} });
    if (selectedPins.length + selectedDrawings.length > 0) showSelBar();
  }
  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if ((polygon[i][1] > point[1]) !== (polygon[j][1] > point[1]) &&
        point[0] < (polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0]) inside = !inside;
    }
    return inside;
  }
  btn.onclick = (e) => { e.stopPropagation(); selecting = !selecting; btn.style.background = selecting ? "#4b5563" : "#6b7280"; state.map.getContainer().style.cursor = selecting ? "crosshair" : ""; if (selecting) state.map.dragging.disable(); else { state.map.dragging.enable(); clearSelection(); } };
  btn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); lassoMode = !lassoMode; btn.textContent = lassoMode ? "◌" : "⊞"; if (!selecting) btn.click(); };
  state.map.getContainer().appendChild(btn);

  state.map.getContainer().addEventListener("pointerdown", (e) => {
    if (!selecting) return; if (e.target.closest("button")) return; if (e.target.closest("#free-draw-toolbar")) return;
    e.preventDefault(); e.stopPropagation();
    const rc = state.map.getContainer().getBoundingClientRect();
    selStart = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
    if (lassoMode) selPoly = L.polyline([[selStart.lat, selStart.lng]], { color: "#2563eb", weight: 1.5, dashArray: "4 4" }).addTo(state.map);
  });
  state.map.getContainer().addEventListener("pointermove", (e) => {
    if (!selecting || !selStart) return;
    const rc = state.map.getContainer().getBoundingClientRect();
    const curr = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
    if (lassoMode && selPoly) { const ll = selPoly.getLatLngs(); ll.push([curr.lat, curr.lng]); selPoly.setLatLngs(ll); }
    else if (!lassoMode) { clearSelLayer(); selRect = L.rectangle(L.latLngBounds(selStart, curr), { color: "#2563eb", weight: 1.5, dashArray: "4 4", fillOpacity: 0.08 }).addTo(state.map); }
  });
  state.map.getContainer().addEventListener("pointerup", (e) => {
    if (!selecting || !selStart) return;
    const rc = state.map.getContainer().getBoundingClientRect();
    const curr = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
    if (lassoMode && selPoly) { const ll = selPoly.getLatLngs(); if (ll.length > 3) selectionForPoly(ll); clearSelLayer(); }
    else if (!lassoMode) { if (selStart.distanceTo(curr) > 5) selectionForBounds(L.latLngBounds(selStart, curr)); clearSelLayer(); }
    selStart = null;
  });
}

export async function renderAnnotationThread(pinId, threadEl) {
  if (!state.dek) return;
  const threads = threadEl ? [threadEl] : document.querySelectorAll(`[data-pin-id="${pinId}"]`);
  if (threads.length === 0) return;

  const annotations = await DB.getAnnotationsByPin(pinId, 0, 100);
  const tombstones = new Set();
  for (const a of annotations) {
    const ts = await DB.getTombstonesForTarget(a.annotation_id);
    for (const t of ts) tombstones.add(a.annotation_id);
  }

  const visible = annotations.filter(a => !tombstones.has(a.annotation_id));

  let html = '<div class="ann-thread-header">Comments</div>';
  if (visible.length === 0) {
    html += '<div style="color:var(--text-dim);font-size:11px;padding:4px 0;">No comments yet</div>';
  }

  for (const ann of visible) {
    try {
      const dec = window._decrypt_annotation(ann.ciphertext, ann.nonce, state.dek);
      const text = dec.text || "";
      const authorName = dec.author_name || "anon";
      const annType = dec.annotation_type || "comment";
      const ttl = dec.ttl;

      const votes = ann.votes || [];
      const trustScore = state.signingPublicKey ? computeAnnotationScore(ann, state.signingPublicKey) : 0;
      const scoreColor = trustScoreColor(trustScore);
      const upvotesRaw = votes.filter(v => v.direction === "up").length;
      const downvotesRaw = votes.filter(v => v.direction === "down").length;

      const typeIcons = { comment: "💬", update: "🔄", dispute: "⚠️", flag: "🚩", death_mark: "💀", story: "📖" };
      const typeIcon = typeIcons[annType] || "💬";
      const typeClass = annType === "death_mark" ? "ann-death" : annType === "dispute" ? "ann-dispute" : "";
      const ttlLabel = ttl ? ` · expires ${relativeTime(Date.now() - (ttl * 1000))}` : "";

      html += `<div class="ann-item ${typeClass}" data-ann-id="${escapeHtml(ann.annotation_id)}">
        <div class="ann-meta">
          <span class="ann-author">${escapeHtml(authorName)}</span>
          <span class="ann-type-icon">${typeIcon}</span>
          <span class="ann-time">${relativeTime(ann.created_at)}</span>
          ${ttlLabel ? `<span class="ann-ttl">${ttlLabel}</span>` : ""}
        </div>
        <div class="ann-text">${escapeHtml(text)}</div>
        <div class="ann-actions">
          <button class="ann-vote-btn ann-up" data-ann-id="${escapeHtml(ann.annotation_id)}">▲ <span class="ann-up-count">${upvotesRaw}</span></button>
          <span class="ann-score" style="font-size:11px;color:${scoreColor};font-weight:600;min-width:28px;text-align:center;">${upvotesRaw - downvotesRaw > 0 ? "+" : ""}${upvotesRaw - downvotesRaw}</span>
          <button class="ann-vote-btn ann-down" data-ann-id="${escapeHtml(ann.annotation_id)}">▼ <span class="ann-down-count">${downvotesRaw}</span></button>
          ${ann.author_pubkey === state.signingPublicKey ? `<button class="ann-delete-btn" data-ann-id="${escapeHtml(ann.annotation_id)}">×</button>` : ""}
        </div>
      </div>`;
    } catch (_) {
      html += '<div class="ann-item ann-encrypted" style="opacity:0.4;font-size:11px;color:var(--text-dim);">🔒 encrypted annotation</div>';
    }
  }

  html += `<div class="ann-form">
    <textarea class="ann-input" placeholder="Add a comment..." rows="2"></textarea>
    <button class="ann-submit-btn">Post</button>
  </div>`;

  for (const el of threads) {
    el.innerHTML = html;
  }
}

export function refreshPinPopup(pinId) {
  if (!pinId) return;
  const marker = state.markers.find(m => m._pinId === pinId);
  if (marker && marker.isPopupOpen && marker.isPopupOpen()) {
    renderAnnotationThread(pinId);
  }
}

export function addWatermark() {
  const el = document.createElement("a");
  el.href = window.location.origin + window.location.pathname;
  el.target = "_blank";
  el.id = "piggpin-watermark";
  el.textContent = "piggPin";
  el.title = "Made with piggPin";
  state.map.getContainer().appendChild(el);
}
// Re-exports from extracted modules (for consumers like main.js)
export {
  loadLayersForSet,
  createLayer,
  renameLayer,
  deleteLayer,
  toggleLayer,
  setLayerOpacity,
  refreshAllLayers,
  showDiscoverModal,
  showLayersModal,
} from "./map-layers.js";
export {
  importLayerFromMap,
  showImportFromMapModal,
} from "./map-import.js";
export {
  loadSchemasForSet,
  renderSchemaFieldsById,
  collectSchemaData,
  buildCustomDataHTML,
  showSchemaManagerModal,
  showSchemaEditorModal,
} from "./map-schemas.js";

