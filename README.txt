fake0hs Arcade
==============

Open index.html to see the arcade. Click "Play Cactus Run" to play.

Folder layout
- index.html              : the arcade homepage
- games/cactus-run/       : Cactus Run (open its README.txt for how to play)
- games/piano-party/      : Pindars Piano Party (open its README.txt for how to play)
- games/home-for-leo/     : Home for Leo (a story merge game, mouse or touch)
- games/abducted/         : Abducted (a horror stealth game, keyboard)

Adding a new game
1. Put the game in its own folder inside games/, e.g. games/my-game/index.html
2. In the arcade's index.html, find the GAMES list near the bottom and add:
   { ready: true, title: "My Game", href: "games/my-game/index.html",
     desc: "One sentence about the game.", needs: ["Keyboard", "1 player"], art: "" }
   Slots without a game automatically show "Under construction".
