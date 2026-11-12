/*
  fake0hs Arcade progress helper
  ------------------------------
  Put this file in the main folder of the website (next to index.html).

  In each game's index.html, add this line just before </body>:
      <script src="../../arcade-progress.js"></script>

  Then, at the moment the player WINS the game, run:
      ArcadeProgress.complete();

  The game is worked out from the folder name (games/cactus-run/ -> "cactus-run").
  In free play (no name picked) nothing is saved.
*/
(function () {
  // ===== ONLINE SAVES =====
  // Paste your Google Apps Script web app address between the quotes.
  // It looks like: https://script.google.com/macros/s/AKfy.../exec
  // Leave it empty ("") to save on this device only.
  var SERVER_URL = "https://script.google.com/macros/s/AKfycbyP-PauYVewxcMk4TYZVm0JOGxI8OKQTyJt5UiuYHtOdcGn2W3ck-7ukhzNoXw67DRhDg/exec";
  // ========================

  var REC_KEY = "fake0hArcade.records", PLAYER_KEY = "fake0hArcade.player", JUST_KEY = "fake0hArcade.just";
  var PENDING_KEY = "fake0hArcade.pending", GAMES_KEY = "fake0hArcade.games";

  function gameId() {
    var m = location.pathname.match(/games\/([^\/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function readJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function player() {
    try { return sessionStorage.getItem(PLAYER_KEY) || null; } catch (e) { return null; }
  }

  // send a message to the family Google Sheet (fire and forget, survives leaving the page)
  function send(payload) {
    if (!SERVER_URL) return false;
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(SERVER_URL, new Blob([body], { type: "text/plain" }))) return true;
    } catch (e) {}
    try {
      fetch(SERVER_URL, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain" }, body: body });
      return true;
    } catch (e) { return false; }
  }

  window.ArcadeProgress = {
    serverUrl: SERVER_URL,

    /* the name picked in the arcade, or null in free play */
    player: player,

    /* mark this game as completed for the current player; returns true if saved */
    complete: function (id) {
      id = id || gameId();
      var p = player();
      if (!p || !id) return false;
      var r = readJSON(REC_KEY, {});
      if (!Array.isArray(r[p])) r[p] = [];
      var isNew = r[p].indexOf(id) < 0;
      if (isNew) {
        r[p].push(id);
        writeJSON(REC_KEY, r);
        try { sessionStorage.setItem(JUST_KEY, id); } catch (e) {}   // the arcade cheers when you come back
      }
      if (SERVER_URL) {
        var games = readJSON(GAMES_KEY, {});
        var title = games[id] || document.title || id;
        var pend = readJSON(PENDING_KEY, []);
        if (!pend.some(function (x) { return x.player === p && x.game === id; })) {
          pend.push({ player: p, game: id, title: title, t: Date.now() });
          writeJSON(PENDING_KEY, pend);
        }
        send({ action: "win", player: p, game: id, title: title, all: Object.keys(games) });
      }
      return true;
    },

    /* has the current player already completed this game? (this device's records) */
    isComplete: function (id) {
      id = id || gameId();
      var p = player(), r = readJSON(REC_KEY, {});
      return !!(p && Array.isArray(r[p]) && r[p].indexOf(id) >= 0);
    },

    /* used by the arcade page */
    send: send,
    pending: function () { return readJSON(PENDING_KEY, []); },
    setPending: function (list) { writeJSON(PENDING_KEY, list); }
  };
})();
