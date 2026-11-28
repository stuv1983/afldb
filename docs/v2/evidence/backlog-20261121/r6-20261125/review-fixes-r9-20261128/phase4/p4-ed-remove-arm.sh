#!/bin/sh
# p4-ed-remove-arm.sh (R6 r9). REHEARSAL ONLY: the "editor" visudo -f runs in p4-scen.sh, standing in for the owner's hand edit of a
# disposed sudoers file. visudo passes its temporary copy as the last argument; this deletes the lines that begin with "arm".
for f; do :; done
sed -i '/^arm[[:space:]]/d' "$f"
