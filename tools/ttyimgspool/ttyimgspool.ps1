# prefix+i in herdr on Windows: runs the bash gallery (ttyimgspool) under Git Bash.
# A launcher, because herdr's command field can't carry a path with spaces, and a bare
# `bash` is WSL's (System32\bash.exe), not Git's.
& "$env:ProgramFiles\Git\bin\bash.exe" "$HOME/.agents/ai-setup/tools/ttyimgspool/ttyimgspool"
