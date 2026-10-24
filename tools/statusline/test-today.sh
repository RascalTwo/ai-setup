#!/usr/bin/env bash
# Replays a week through today(): day boundaries, carry-over, overspend.
source "$(dirname "$0")/statusline-lib.sh"
DAY_STATE=$(mktemp -d)/day-start.json
R=1792216800; W=$((R-604800)); H=3600; fail=0
check() { got=$(today "$1" "$R" "$2"); [ "$got" = "$3" ] || { echo "FAIL util=$1: got $got want $3"; fail=1; }; }
check 0  $((W+4*H))        0.0/14.3    # fresh window: 100/7
check 7  $((W+20*H))       7.0/14.3    # used 7 of Saturday's 14.3
check 7  $((W+24*H+H))     0.0/15.5    # Sunday: Saturday's leftover spread over 6 days
check 15 $((W+24*H+19*H))  8.0/15.5    # used 8 today
check 25 $((W+24*H+22*H))  18.0/15.5   # overspent
check 25 $((W+48*H+H))     0.0/15.0    # Monday: overage spread, 75/5
[ $fail = 0 ] && echo ok; exit $fail
