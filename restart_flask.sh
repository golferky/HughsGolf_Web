#!/bin/bash
# restart_flask.sh — restart ONE Hugh's Golf site on the QNAP without deploying.  RUN ON THE MAC.
#   ./restart_flask.sh sandbox     (default)
#   ./restart_flask.sh live
# Only the chosen site is restarted (matched by its folder) — the other is never touched.
SITE="${1:-sandbox}"
BASE="/share/CACHEDEV3_DATA/My Stuff/HughsGolf"
SSH_OPTS=()
[ -f "$HOME/.ssh/id_ed25519_qnap" ] && SSH_OPTS=(-i "$HOME/.ssh/id_ed25519_qnap")
ssh "${SSH_OPTS[@]}" GaryAdmin@192.168.1.176 "sh \"$BASE/hughsgolf_ctl.sh\" $SITE restart && sh \"$BASE/hughsgolf_ctl.sh\" $SITE status"
