Cactus Run
==========

How to play
1. Double-click index.html (or drag it into Chrome or Edge).
2. Click "Start camera" and allow camera access.
3. Stand back so the camera sees you from the hips up.
4. Raise both hands above your head to start.
5. Step left and right to dodge obstacles and collect coins.
6. Each coin fills one notch of the power bar on the right side.
7. At 3 coins the bar fills and you travel to the next world
   automatically. The bar resets to 0.
8. Jump in real life and your character jumps too. Jumping clears
   obstacles, and each jump heals one lost heart.
   (Keyboard: Space or Up arrow to jump.)

Worlds
 1 Sunset Desert      - cacti
 2 Snowy Peaks        - snowmen
 3 Deep Forest        - tree stumps
 4 Sunny Beach        - crabs
 5 Under the Sea      - jellyfish
 6 Neon City          - traffic cones
 7 Volcano Valley     - lava rocks
 8 Moon Base          - space rocks
 9 Candy Land         - lollipops
10 Haunted Graveyard  - tombstones
11+ Champion Stadium  - hurdles, with a cheering crowd

Testing shortcut: while playing, hold Shift and press 1-9 or 0 to jump
to that world, or Shift+S for the stadium.

Files
- index.html : the page (open this one)
- style.css  : colors, fonts and menu styling
- game.js    : camera, body tracking, worlds, game logic and drawing

Easy things to tweak in game.js
- GAIN        : how far the figure moves per step (raise it for small rooms)
- CHARGE_MAX  : coins needed to fill the power bar (3)
- COIN_SIZE   : how big coins are
- JUMP_THRESHOLD : how high you must jump to trigger (lower = easier)
- JUMP_DUR    : how long the character stays in the air
- coinTimer   : how often coins appear
- THEMES      : each world's colors, scenery and obstacle drawing
