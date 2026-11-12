Abducted
========

A farmer's animals keep vanishing from a yard with no way out. He camps out to
watch, falls asleep... and wakes up tied in plastic chains on an alien spaceship.

How to play
- WASD or arrow keys: move
- E: use things (hide in closets, smash glass cases, read screens, fly the ship)
- Space: break the chains at the start, then fire the stun gun once you find it
- Left click: walk to that spot (the farmer finds his way around walls).
  Click a closet, glass case or screen to walk over and use it.
  Click while hiding to come out. Clicking also breaks the chains.
- Right click: same as E, plus a quick burst of speed. Each burst uses stamina
  (the bar under the farmer). Use too many and you get tired and slow down
  until you catch your breath.

Sneak through three decks of the ship. Aliens carry flashlights: if you step into
their beam, or bump into one, you get caught (jump scare!) and start again at that
deck's spawn point. Hide in closets when an alien comes near. Your heartbeat gets
louder when an alien is close.

Deck 1 (Holding Cells): find the hammer, smash the glass case for the red keycard.
Deck 2 (Specimen Lab): find the stun gun and the blue keycard. The missing farm
  animals are in the pods!
Deck 3 (Command Deck): steal the captain's gold keycard, reach the bridge
  (a checkpoint), and take control of the ship to fly home.

Easy things to tweak (top of the script in index.html)
- PLAYER_SPEED, ALIEN_PATROL, ALIEN_HUNT : how fast everyone moves
- VIEW_RANGE, VIEW_ANGLE                 : how far and how wide aliens can see
- LIGHT_RADIUS                           : how much of the dark you can see
- STUN_TIME, STUN_RANGE                  : the stun gun
- BURST_SPEED, BURST_TIME, BURST_COST    : right-click speed bursts
- STAMINA_REGEN, TIRED_SPEED             : how fast you recover, how slow when tired

Adding more decks: each deck is a text map in the DECKS list. Copy one, change
the map, and set where the aliens walk. The legend is written above the list.

Testing shortcuts: Shift+1, Shift+2, Shift+3 jump to a deck with the items you'd
have by then. Shift+0 goes straight to the bridge.
