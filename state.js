let _user = { id: crypto.randomUUID() };
let _displayName = "Me";
let _signingPublicKey = null;
let _signingSecretKey = null;
let _currentSet = null;
let _currentCommunity = null;
let _dek = null;
let _map = null;
let _clusterGroup = null;
const _markers = [];
const _drawingLayers = [];
const _chainLayers = [];
const _subscribedDEKs = new Map();     // "communityId:layerId" → Uint8Array
const _subscribedMarkers = [];         // L.Marker[] from subscribed layers
const _subscribedDrawingLayers = [];   // L.Layer[] from subscribed layers
const _notifications = [];
const _pinSearchText = [];
let _placingPin = false;
let _streetViewing = false;
let _freeDrawing = false;
let _freePoints = [];
let _freePreview = null;
const _freeStrokes = [];
const _freeUndoStack = [];
let _freeStrokeColor = "#7c3aed";
let _freeStrokeWidth = 3;
let _measuring = false;
let _lastPlacedPinId = null;
let _pendingConnId = null;
const _peers = new Map();
let _suppressMapSync = false;
let _followMap = true;
const _hostedConnections = new Set();
const _history = [];

// Intra-set layers (per current set)
let _layers = [];
const _schemas = [];
let _activeLayerId = null;
let _timeFrom = null;
let _timeTo = null;
let _minTrustScore = null;
const DEFAULT_LAYER_COLOR = "#7c3aed";
const LAYER_PALETTE = ["#7c3aed", "#2563eb", "#16a34a", "#f97316", "#eab308", "#ec4899", "#ef4444", "#0891b2"];

export const state = {
  get user() { return _user; },
  set user(v) { _user = v; },
  get displayName() { return _displayName; },
  set displayName(v) { _displayName = v; },
  get signingPublicKey() { return _signingPublicKey; },
  set signingPublicKey(v) { _signingPublicKey = v; },
  get signingSecretKey() { return _signingSecretKey; },
  set signingSecretKey(v) { _signingSecretKey = v; },
  get currentSet() { return _currentSet; },
  set currentSet(v) { _currentSet = v; },
  get currentCommunity() { return _currentCommunity; },
  set currentCommunity(v) { _currentCommunity = v; },
  get myRole() {
    if (!_currentCommunity || !_signingPublicKey) return null;
    const me = (_currentCommunity.members || []).find(m => m.pubkey === _signingPublicKey);
    return me ? me.role : null;
  },
  get dek() { return _dek; },
  set dek(v) { _dek = v; },
  get map() { return _map; },
  set map(v) { _map = v; },
  get clusterGroup() { return _clusterGroup; },
  set clusterGroup(v) { _clusterGroup = v; },
  get markers() { return _markers; },
  get drawingLayers() { return _drawingLayers; },
  get chainLayers() { return _chainLayers; },
  get pinSearchText() { return _pinSearchText; },
  get placingPin() { return _placingPin; },
  set placingPin(v) { _placingPin = v; },
  get streetViewing() { return _streetViewing; },
  set streetViewing(v) { _streetViewing = v; },
  get freeDrawing() { return _freeDrawing; },
  set freeDrawing(v) { _freeDrawing = v; },
  get freePoints() { return _freePoints; },
  set freePoints(v) { _freePoints = v; },
  get freePreview() { return _freePreview; },
  set freePreview(v) { _freePreview = v; },
  get freeStrokes() { return _freeStrokes; },
  get freeUndoStack() { return _freeUndoStack; },
  get freeStrokeColor() { return _freeStrokeColor; },
  set freeStrokeColor(v) { _freeStrokeColor = v; },
  get freeStrokeWidth() { return _freeStrokeWidth; },
  set freeStrokeWidth(v) { _freeStrokeWidth = v; },
  get measuring() { return _measuring; },
  set measuring(v) { _measuring = v; },
  get lastPlacedPinId() { return _lastPlacedPinId; },
  set lastPlacedPinId(v) { _lastPlacedPinId = v; },
  get pendingConnId() { return _pendingConnId; },
  set pendingConnId(v) { _pendingConnId = v; },
  get peers() { return _peers; },
  get suppressMapSync() { return _suppressMapSync; },
  set suppressMapSync(v) { _suppressMapSync = v; },
  get followMap() { return _followMap; },
  set followMap(v) { _followMap = v; },
  get hostedConnections() { return _hostedConnections; },
  get history() { return _history; },
  get layers() { return _layers; },
  set layers(v) { _layers = v; },
  get schemas() { return _schemas; },
  set schemas(v) { _schemas.splice(0, _schemas.length, ...v); },
  get activeLayerId() { return _activeLayerId; },
  set activeLayerId(v) { _activeLayerId = v; },
  get timeFrom() { return _timeFrom; },
  set timeFrom(v) { _timeFrom = v; },
  get timeTo() { return _timeTo; },
  set timeTo(v) { _timeTo = v; },
  get minTrustScore() { return _minTrustScore; },
  set minTrustScore(v) { _minTrustScore = v; },
  get defaultLayerColor() { return DEFAULT_LAYER_COLOR; },
  get layerPalette() { return LAYER_PALETTE; },
  get subscribedDEKs() { return _subscribedDEKs; },
  get subscribedMarkers() { return _subscribedMarkers; },
  get subscribedDrawingLayers() { return _subscribedDrawingLayers; },
  get notifications() { return _notifications; },
  set notifications(v) { _notifications.splice(0, _notifications.length, ...(v || [])); },
  get unreadNotificationCount() { return _notifications.filter(n => !n.read).length; },
};
