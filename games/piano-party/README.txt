Pindars Piano Party
===================

How to play
1. Open index.html in Chrome or Edge, click "Start camera" and allow access.
2. Stand back so the camera can see your whole body.
3. The floor is a giant piano. Walk left and right, stomp, and jump to play notes.
   Landing from a jump plays a chord with both feet.
4. Balloons fly across the sky. Touch them with your hands to pop them into
   fireworks. Each color plays a different drum:
   red = kick, blue = snare, green = tom, yellow = clap, purple = crash, orange = low tom
5. The background beat follows your movement. Move more and the beat gets
   faster and louder, and more balloons appear. Stand still and it calms down.
6. Watch out for bombs with a skull and crossbones! Pop one and the whole
   screen explodes and your stick figure gets knocked flat. Two drums appear:
   bang them fast with your hands to fill the get-up meter and stand back up.
7. Pop 100 balloons to win. If three bombs go off, it's game over.
8. The Exit button in the top-right corner goes back to the arcade.

Keyboard and mouse: arrows walk, Space jumps, click balloons to pop them.
When knocked down, tap Space fast (or click the drums) to bang the drums.

Easy things to tweak (top of game.js)
- BPM_SLOW / BPM_FAST : slowest and fastest beat
- FIRST_NOTE          : lowest note on the keyboard (48 = C3)
- WHITE_KEYS          : how many keys on the floor
- GAIN                : how far the figure moves per step
- JUMP_THRESHOLD      : how high you must jump (lower = easier)
- BOMB_CHANCE         : how often bombs appear (0.12 = about 1 in 8)
- RECOVER_PER_HIT     : how much each drum hit fills the get-up meter
- RECOVER_DECAY       : how fast the get-up meter drains
- WIN_BALLOONS        : balloons needed to win (100)
- MAX_BOMBS           : bomb blasts before game over (3)

Testing shortcut: Shift+B sends a bomb right away.
