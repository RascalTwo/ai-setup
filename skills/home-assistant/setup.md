# Home Assistant setup

Ask the user to do these two steps; only they can.

1. In Home Assistant, click your name at the bottom left, open the **Security** tab, find **Long-lived access tokens**, choose **Create token**, name it after this assistant, and copy it. It is shown only once.
2. In your own terminal window, run this and paste at the hidden prompt. It tests the URL and token before saving anything, and only your user can read the saved token.

   `python3 ~/.claude/skills/home-assistant/scripts/ha.py setup http://<host>:8123`

To add another machine you can reach over SSH, without showing the token (Windows target shown; use `python3` and `~/` for Mac or Linux):

`ssh <machine> 'python %USERPROFILE%\.claude\skills\home-assistant\scripts\ha.py setup http://<host>:8123' < ~/.config/home-assistant/token`

Check it with `ha.py api GET /api/config`.
