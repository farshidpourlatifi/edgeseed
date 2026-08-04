# Records the real `pnpm verify` gate for the landing page terminal demo.
# Re-record with: vhs docs/assets/verify-demo.tape   (from the repo root)
Require pnpm

Output apps/web/public/demo/verify.webm
Output apps/web/public/demo/verify.mp4

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1100
Set Height 700
Set Padding 16
Set Framerate 24
Set PlaybackSpeed 2.5
Set TypingSpeed 60ms

Type "pnpm verify"
Enter
Wait+Screen@300s /8 passed/
Sleep 4s
