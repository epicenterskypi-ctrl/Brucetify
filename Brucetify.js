// Brucetify - reproductor por WiFi para Bruce (M5StickS3, con bocina)
// Pide las canciones al servidor Python que corre en Termux (brucetify_server.py).
// En el M5 solo se guarda UN trozo temporal (/bt_tmp.wav) que se sobrescribe.
//
// Prev / Next = moverse por la lista   Sel = reproducir (sigue con la siguiente)
// Esc = salir (durante la reproduccion actua al terminar el trozo actual)

var keyboard = require('keyboard');
var audio = require('audio');
var display = require('display');
var storage = require('storage');
var wifi = require('wifi');
var dialog = require('dialog');

var SERVER = "http://192.168.1.50:8080"; // IP del celular (la muestra el servidor al iniciar)
var CFG = "/brucetify.cfg";              // aqui se recuerda la ultima IP usada
var TMP = "/bt_tmp.wav";
var ROWS = 5;

var songs = [];
var part = 65536;
var sel = 0;
var top = 0;
var selWas = false;

function draw(status) {
  var i, idx, y, nm;
  display.fill(display.color(0, 0, 0));
  display.setTextSize(2);
  display.setTextColor(display.color(80, 230, 120));
  display.drawString("Brucetify", 6, 4);
  display.setTextSize(1);
  display.setTextColor(display.color(150, 150, 150));
  display.drawString(status, 118, 10);

  if (!songs.length) {
    display.setTextColor(display.color(225, 168, 106));
    display.drawString("Sin canciones", 6, 50);
    display.drawString("Subelas desde el celular", 6, 65);
    return;
  }

  if (sel < top) top = sel;
  if (sel >= top + ROWS) top = sel - ROWS + 1;

  display.setTextSize(2);
  for (i = 0; i < ROWS; i++) {
    idx = top + i;
    if (idx >= songs.length) break;
    y = 26 + i * 21;
    nm = songs[idx].title;
    if (nm.length > 18) nm = nm.substring(0, 18);
    if (idx === sel) {
      display.drawFillRect(0, y - 2, 240, 20, display.color(80, 230, 120));
      display.setTextColor(display.color(0, 0, 0));
    } else {
      display.setTextColor(display.color(255, 255, 255));
    }
    display.drawString(nm, 6, y);
  }
  if (display.update) display.update();
}

function message(text) {
  display.fill(display.color(0, 0, 0));
  display.setTextSize(1);
  display.setTextColor(display.color(225, 168, 106));
  display.drawString(text, 6, 50);
  if (display.update) display.update();
  delay(1500);
}

function loadServer() {
  var s;
  try {
    s = storage.read(CFG);
    if (s && s.length > 8) SERVER = s;
  } catch (e) {}
}

// Descarga la lista: primera linea "#part|N", luego "id|titulo|trozos|segundos"
function fetchList() {
  var r, lines, i, f;
  try {
    r = wifi.httpFetch(SERVER + "/api/list", { responseType: "string" });
  } catch (e) {
    return false;
  }
  if (!r || r.status !== 200) return false;
  songs = [];
  lines = r.body.split("\n");
  for (i = 0; i < lines.length; i++) {
    f = lines[i].split("|");
    if (f[0] === "#part") part = parseInt(f[1], 10) || part;
    else if (f.length >= 3) songs.push({ id: f[0], title: f[1], chunks: parseInt(f[2], 10) || 1 });
  }
  return true;
}

function connect() {
  if (!wifi.connected()) wifi.connectDialog();
  return wifi.connected();
}

// Baja un trozo WAV en partes pequenas y lo escribe en TMP (sobrescribe)
function downloadChunk(id, c) {
  var p = 0;
  var r, b, len;
  try { storage.remove(TMP); } catch (e) {}
  while (true) {
    try {
      r = wifi.httpFetch(SERVER + "/song/" + id + "/" + c + "/" + p, { responseType: "binary" });
    } catch (e2) {
      return false;
    }
    if (!r || r.status !== 200) return p > 0;
    b = r.body;
    len = b ? b.length : 0;
    if (len > 0 && !storage.write(TMP, b, p === 0 ? "write" : "append")) return false;
    if (len < part) return p > 0 || len > 0;
    p++;
  }
}

// Reproduce una cancion completa. Devuelve false si se corto (Esc o error)
function playSong(i) {
  var s = songs[i];
  var c;
  for (c = 0; c < s.chunks; c++) {
    if (keyboard.getEscPress(true)) return false;
    sel = i;
    draw("Bajando " + (c + 1) + "/" + s.chunks);
    if (!downloadChunk(s.id, c)) {
      message("Error de red");
      return false;
    }
    draw("Sonando " + (c + 1) + "/" + s.chunks);
    try {
      audio.playFile(TMP);
    } catch (e) {
      message("No se pudo reproducir");
      return false;
    }
  }
  return true;
}

function playFrom(i) {
  while (playSong(i)) {
    i = (i + 1) % songs.length;
  }
  try { storage.remove(TMP); } catch (e) {}
}

// ---------- Inicio ----------

loadServer();
draw("Conectando...");

if (!connect()) {
  message("Sin WiFi");
} else {
  draw("Buscando servidor...");
  while (!fetchList()) {
    var ip = dialog.prompt("Servidor (http://IP:8080)", 40, SERVER);
    if (!ip) break;
    SERVER = ip;
  }
  if (songs.length || SERVER) {
    try { storage.write(CFG, SERVER, "write"); } catch (e) {}
  }
}

draw(songs.length + " canciones");

while (true) {
  if (keyboard.getEscPress(true)) break;

  if (songs.length) {
    if (keyboard.getNextPress()) {
      sel = (sel + 1) % songs.length;
      draw(songs.length + " canciones");
    }
    if (keyboard.getPrevPress()) {
      sel = (sel + songs.length - 1) % songs.length;
      draw(songs.length + " canciones");
    }
    var now = keyboard.getSelPress();
    if (now && !selWas) {
      playFrom(sel);
      draw(songs.length + " canciones");
    }
    selWas = now;
  }
  delay(30);
}
