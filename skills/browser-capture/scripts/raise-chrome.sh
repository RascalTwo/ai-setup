#!/bin/bash
# raise-chrome.sh <url-substring>
#
# Make a Chrome tab satisfy getDisplayMedia's precondition: it must be the SELECTED tab in a
# window that is frontmost and unoccluded, or the page reports visibilityState "hidden" and
# getDisplayMedia rejects with InvalidStateError.
#
# macOS marks a Chrome page hidden when its window is occluded by ANOTHER APP — so a window
# sitting behind your editor is enough to break capture. That is the whole trick; it has
# nothing to do with headlessness.
#
# Run this immediately before the trusted click that starts recording. Once capture is live,
# Chrome pins the tab visible and none of this matters any more.
set -e
MATCH="${1:?usage: raise-chrome.sh <url-substring>}"

osascript <<EOF
tell application "Google Chrome"
  activate
  set found to 0
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      if URL of t contains "$MATCH" then
        if found = 0 then
          set active tab index of w to ti
          set index of w to 1
          set found to 1
        end if
      end if
    end repeat
  end repeat
  if found = 0 then error "no tab matching: $MATCH"
end tell
delay 0.6
tell application "System Events" to set frontmost of process "Google Chrome" to true
delay 0.4
tell application "System Events" to return "frontmost: " & (name of first application process whose frontmost is true)
EOF
