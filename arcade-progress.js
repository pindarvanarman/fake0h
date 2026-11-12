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
  var REC_KEY = "fake0hArcade.records", PLAYER_KEY = "fake0hArcade.player", JUST_KEY = "fake0hArcade.just";

  function gameId() {
    var m = location.pathname.match(/games\/([^\/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function readRecords() {
    try { return JSON.parse(localStorage.getItem(REC_KEY)) || {}; } catch (e) { return {}; }
  }
  function player() {
    try { return sessionStorage.getItem(PLAYER_KEY) || null; } catch (e) { return null; }
  }

  window.ArcadeProgress = {
    /* the name picked in the arcade, or null in free play */
    player: player,

    /* mark this game as completed for the current player; returns true if saved */
    complete: function (id) {
      id = id || gameId();
      var p = player();
      if (!p || !id) return false;
      var r = readRecords();
      if (!Array.isArray(r[p])) r[p] = [];
      if (r[p].indexOf(id) < 0) {
        r[p].push(id);
        try {
          localStorage.setItem(REC_KEY, JSON.stringify(r));
          sessionStorage.setItem(JUST_KEY, id);   // the arcade cheers when you come back
        } catch (e) { return false; }
      }
      return true;
    },

    /* has the current player already completed this game? */
    isComplete: function (id) {
      id = id || gameId();
      var p = player(), r = readRecords();
      return !!(p && Array.isArray(r[p]) && r[p].indexOf(id) >= 0);
    }
  };
})();
