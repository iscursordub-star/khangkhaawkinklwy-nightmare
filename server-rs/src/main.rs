use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, RwLock};

const DEFAULT_PORT: u16 = 4000;
const MAX_PEERS: usize = 8;
const MAX_PRESENCE: usize = 4096;
const MAX_MSG_PER_SEC: u32 = 60;
const MAX_PAYLOAD_BYTES: usize = 8 * 1024;

#[derive(Clone, Serialize, Deserialize, Default)]
struct RoomMeta {
    #[serde(default)]
    name: String,
    #[serde(default)]
    ch: String,
    #[serde(default)]
    started: bool,
    #[serde(default)]
    bots: u8,
}

impl RoomMeta {
    fn cleaned(x: Option<RoomMeta>) -> Self {
        let m = x.unwrap_or_default();
        Self {
            name: m.name.chars().take(40).collect(),
            ch: m.ch.chars().take(8).collect(),
            started: m.started,
            bots: m.bots.min(3),
        }
    }
}

#[derive(Serialize)]
struct RoomInfo {
    room: String,
    name: String,
    players: usize,
    max: usize,
    ch: String,
    started: bool,
    bots: u8,
}

#[derive(Serialize)]
struct PeerSnapshot {
    peer: String,
    p: Map<String, Value>,
}

struct PeerConn {
    tx: mpsc::UnboundedSender<Message>,
    p: Map<String, Value>,
    cid: String,
}

struct Room {
    peers: HashMap<String, PeerConn>,
    host: Option<String>,
    host_pending: bool,
    pub_room: bool,
    meta: RoomMeta,
    banned: HashSet<String>,
}

struct AppState {
    server_name: String,
    server_list_json: String,
    index_path: String,
    rooms: RwLock<HashMap<String, Room>>,
    id_seq: AtomicU64,
}

#[derive(Deserialize)]
struct ClientMsg {
    t: String,
    room: Option<String>,
    cid: Option<String>,
    host: Option<bool>,
    #[serde(rename = "pub")]
    pub_room: Option<bool>,
    meta: Option<RoomMeta>,
    p: Option<Map<String, Value>>,
    peer: Option<String>,
}

fn send_json(tx: &mpsc::UnboundedSender<Message>, val: Value) {
    if let Ok(txt) = serde_json::to_string(&val) {
        let _ = tx.send(Message::Text(txt));
    }
}

fn broadcast_room(
    rooms_map: &HashMap<String, Room>,
    room_name: &str,
    val: &Value,
    except_id: Option<&str>,
) {
    let Some(room) = rooms_map.get(room_name) else {
        return;
    };
    let Ok(txt) = serde_json::to_string(val) else {
        return;
    };
    for (pid, c) in &room.peers {
        if Some(pid.as_str()) != except_id {
            let _ = c.tx.send(Message::Text(txt.clone()));
        }
    }
}

fn is_valid_room_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 32
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("RS_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    let server_name =
        std::env::var("SERVER_NAME").unwrap_or_else(|_| "Rust WS".to_string());

    let server_list_json = std::env::var("SERVER_LIST")
        .ok()
        .and_then(|r| serde_json::from_str::<Value>(&r).ok())
        .map(|v| v.to_string())
        .unwrap_or_else(|| "[]".to_string());

    let index_path =
        std::env::var("INDEX_PATH").unwrap_or_else(|_| "../index.html".to_string());

    let state = Arc::new(AppState {
        server_name: server_name.clone(),
        server_list_json,
        index_path,
        rooms: RwLock::new(HashMap::new()),
        id_seq: AtomicU64::new(1),
    });

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route(
            "/servers",
            get({
                let st = Arc::clone(&state);
                move || async move {
                    (
                        StatusCode::OK,
                        [
                            (header::CONTENT_TYPE, "application/json"),
                            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
                        ],
                        st.server_list_json.clone(),
                    )
                }
            }),
        )
        .route(
            "/",
            get({
                let st = Arc::clone(&state);
                move || serve_index(Arc::clone(&st))
            }),
        )
        .route(
            "/index.html",
            get({
                let st = Arc::clone(&state);
                move || serve_index(Arc::clone(&st))
            }),
        )
        .route(
            "/ws",
            get({
                let st = Arc::clone(&state);
                move |ws: WebSocketUpgrade| async move {
                    ws.max_message_size(MAX_PAYLOAD_BYTES)
                        .on_upgrade(move |socket| handle_socket(socket, st))
                }
            }),
        );

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Rust Server {} listening on port {}", server_name, port);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind port");

    axum::serve(listener, app).await.expect("Server error");
}

async fn serve_index(state: Arc<AppState>) -> impl IntoResponse {
    match tokio::fs::read(&state.index_path).await {
        Ok(data) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            data,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "index.html not found").into_response(),
    }
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    let writer_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut ping_timer = tokio::time::interval(Duration::from_secs(25));
    ping_timer.tick().await;

    let mut joined_room: Option<String> = None;
    let mut peer_id: Option<String> = None;
    let mut window_start = Instant::now();
    let mut msg_count: u32 = 0;

    loop {
        tokio::select! {
            _ = ping_timer.tick() => {
                if tx.send(Message::Ping(vec![])).is_err() {
                    break;
                }
            }
            maybe_msg = ws_receiver.next() => {
                let Some(Ok(msg)) = maybe_msg else {
                    break;
                };

                match msg {
                    Message::Close(_) => break,
                    Message::Pong(_) => continue,
                    Message::Ping(p) => {
                        let _ = tx.send(Message::Pong(p));
                        continue;
                    }
                    Message::Text(text) => {
                        let now = Instant::now();
                        if now.duration_since(window_start) > Duration::from_secs(1) {
                            window_start = now;
                            msg_count = 0;
                        }
                        msg_count += 1;
                        if msg_count > MAX_MSG_PER_SEC {
                            continue;
                        }

                        let Ok(m) = serde_json::from_str::<ClientMsg>(&text) else {
                            continue;
                        };

                        match m.t.as_str() {
                            "list" => {
                                let rooms_guard = state.rooms.read().await;
                                let mut list = Vec::new();
                                for (n, r) in rooms_guard.iter() {
                                    if r.pub_room && r.peers.len() < MAX_PEERS {
                                        list.push(RoomInfo {
                                            room: n.clone(),
                                            name: if r.meta.name.is_empty() {
                                                "Room".to_string()
                                            } else {
                                                r.meta.name.clone()
                                            },
                                            players: r.peers.len(),
                                            max: MAX_PEERS,
                                            ch: r.meta.ch.clone(),
                                            started: r.meta.started,
                                            bots: r.meta.bots,
                                        });
                                    }
                                }
                                send_json(
                                    &tx,
                                    serde_json::json!({
                                        "t": "rooms",
                                        "name": state.server_name,
                                        "list": list,
                                    }),
                                );
                            }
                            "join" if joined_room.is_none() => {
                                let room_str = m.room.unwrap_or_default();
                                if !is_valid_room_name(&room_str) {
                                    send_json(&tx, serde_json::json!({ "t": "err", "code": "badroom" }));
                                    continue;
                                }
                                let cid: String = m.cid.unwrap_or_default().chars().take(24).collect();
                                let is_host_req = m.host.unwrap_or(false);

                                let mut rooms_guard = state.rooms.write().await;
                                if !rooms_guard.contains_key(&room_str) {
                                    if !is_host_req {
                                        send_json(&tx, serde_json::json!({ "t": "err", "code": "noroom" }));
                                        continue;
                                    }
                                    rooms_guard.insert(
                                        room_str.clone(),
                                        Room {
                                            peers: HashMap::new(),
                                            host: None,
                                            host_pending: true,
                                            pub_room: m.pub_room.unwrap_or(false),
                                            meta: RoomMeta::cleaned(m.meta),
                                            banned: HashSet::new(),
                                        },
                                    );
                                }

                                let r = rooms_guard.get_mut(&room_str).unwrap();
                                if r.banned.contains(&cid) {
                                    send_json(&tx, serde_json::json!({ "t": "err", "code": "banned" }));
                                    continue;
                                }
                                if r.peers.len() >= MAX_PEERS {
                                    send_json(&tx, serde_json::json!({ "t": "err", "code": "full" }));
                                    continue;
                                }

                                let seq = state.id_seq.fetch_add(1, Ordering::Relaxed);
                                let new_id = format!("p{:x}", seq);
                                r.peers.insert(
                                    new_id.clone(),
                                    PeerConn {
                                        tx: tx.clone(),
                                        p: Map::new(),
                                        cid,
                                    },
                                );
                                if r.host_pending {
                                    r.host = Some(new_id.clone());
                                    r.host_pending = false;
                                }

                                let snap_list: Vec<PeerSnapshot> = r
                                    .peers
                                    .iter()
                                    .map(|(k, c)| PeerSnapshot {
                                        peer: k.clone(),
                                        p: c.p.clone(),
                                    })
                                    .collect();

                                send_json(
                                    &tx,
                                    serde_json::json!({
                                        "t": "snap",
                                        "id": new_id,
                                        "list": snap_list,
                                    }),
                                );
                                broadcast_room(
                                    &rooms_guard,
                                    &room_str,
                                    &serde_json::json!({
                                        "t": "p",
                                        "peer": new_id,
                                        "p": {},
                                    }),
                                    Some(&new_id),
                                );

                                joined_room = Some(room_str);
                                peer_id = Some(new_id);
                            }
                            "p" => {
                                if let (Some(r_name), Some(pid), Some(patch)) =
                                    (&joined_room, &peer_id, m.p)
                                {
                                    let mut rooms_guard = state.rooms.write().await;
                                    if let Some(r) = rooms_guard.get_mut(r_name) {
                                        if let Some(c) = r.peers.get_mut(pid) {
                                            let mut merged = c.p.clone();
                                            for (k, v) in &patch {
                                                merged.insert(k.clone(), v.clone());
                                            }
                                            let size = serde_json::to_string(&merged)
                                                .map(|s| s.len())
                                                .unwrap_or(MAX_PRESENCE + 1);
                                            if size > MAX_PRESENCE {
                                                continue;
                                            }
                                            c.p = merged;
                                            broadcast_room(
                                                &rooms_guard,
                                                r_name,
                                                &serde_json::json!({
                                                    "t": "p",
                                                    "peer": pid,
                                                    "p": patch,
                                                }),
                                                Some(pid),
                                            );
                                        }
                                    }
                                }
                            }
                            "meta" => {
                                if let (Some(r_name), Some(pid)) = (&joined_room, &peer_id) {
                                    let mut rooms_guard = state.rooms.write().await;
                                    if let Some(r) = rooms_guard.get_mut(r_name) {
                                        if r.host.as_deref() == Some(pid.as_str()) {
                                            if let Some(pub_val) = m.pub_room {
                                                r.pub_room = pub_val;
                                            }
                                            r.meta = RoomMeta::cleaned(m.meta);
                                        }
                                    }
                                }
                            }
                            "kick" => {
                                if let (Some(r_name), Some(pid), Some(target)) =
                                    (&joined_room, &peer_id, m.peer)
                                {
                                    if target != *pid {
                                        let mut rooms_guard = state.rooms.write().await;
                                        if let Some(r) = rooms_guard.get_mut(r_name) {
                                            if r.host.as_deref() == Some(pid.as_str()) {
                                                if let Some(t_peer) = r.peers.remove(&target) {
                                                    r.banned.insert(t_peer.cid);
                                                    send_json(
                                                        &t_peer.tx,
                                                        serde_json::json!({ "t": "kicked" }),
                                                    );
                                                    let _ = t_peer.tx.send(Message::Close(None));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "ping" => {
                                send_json(&tx, serde_json::json!({ "t": "pong" }));
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    if let (Some(r_name), Some(pid)) = (joined_room, peer_id) {
        let mut rooms_guard = state.rooms.write().await;
        if let Some(r) = rooms_guard.get_mut(&r_name) {
            r.peers.remove(&pid);
            if r.host.as_deref() == Some(pid.as_str()) {
                for (_, c) in r.peers.drain() {
                    send_json(&c.tx, serde_json::json!({ "t": "closed" }));
                    let _ = c.tx.send(Message::Close(None));
                }
                rooms_guard.remove(&r_name);
            } else {
                broadcast_room(
                    &rooms_guard,
                    &r_name,
                    &serde_json::json!({ "t": "left", "peer": pid }),
                    None,
                );
            }
        }
    }

    drop(tx);
    let _ = writer_task.await;
}
