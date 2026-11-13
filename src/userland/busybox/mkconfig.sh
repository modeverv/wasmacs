#!/bin/bash
# mkconfig.sh - generate a BusyBox .config from an applet whitelist.
#
#   mkconfig.sh <busybox-srcdir> <builddir> <applets.list> <settings.list>
#
# 1. every symbol that guards an applet (IF_<SYM>(APPLET...) in the "//applet:"
#    source annotations) is forced to "y" if whitelisted, else "not set";
# 2. settings.list lines are applied on top (they win);
# 3. "make oldconfig" fills every other symbol with its Kconfig default;
# 4. the result is checked: a requested value that Kconfig refused (unmet
#    dependency, typo) is an error.
#
# Needs: GNU make as $MAKE (default "make"), a native C compiler as $HOSTCC.
set -euo pipefail
SRC=$1; BLD=$2; APPLETS=$3; SETTINGS=$4
MAKE=${MAKE:-make}
HOSTCC=${HOSTCC:-cc}
mkdir -p "$BLD"
seed="$BLD/.config.seed"

all_applet_syms() {
	grep -rh -E '^//applet:' --include='*.c' "$SRC" \
	| grep -o -E 'IF_[A-Z0-9_]+\(' | sed -E 's/^IF_//; s/\($//' | sort -u
}

all_applet_syms > "$BLD/.applet-syms"
sed -e 's/#.*//' -e 's/[[:space:]]//g' -e '/^$/d' "$APPLETS" | sort -u > "$BLD/.applet-want"

# whitelisted symbols that do not exist in this BusyBox version
missing=$(comm -13 "$BLD/.applet-syms" "$BLD/.applet-want" || true)
if [ -n "$missing" ]; then
	echo "mkconfig: whitelisted applet symbols unknown to this tree:" $missing >&2
	exit 1
fi

{
	# applets: on if whitelisted, off otherwise
	comm -12 "$BLD/.applet-syms" "$BLD/.applet-want" | sed -e 's/^/CONFIG_/' -e 's/$/=y/'
	comm -23 "$BLD/.applet-syms" "$BLD/.applet-want" | sed -e 's/^/CONFIG_/' -e 's/$/=n/'
	# explicit settings
	sed -e 's/^[[:space:]]*#.*//' -e '/^[[:space:]]*$/d' "$SETTINGS"
} | awk -F= '
	{ name=$1; val=substr($0, length(name)+2); if (!(name in v)) order[++n]=name; v[name]=val }
	END { for (i=1;i<=n;i++) { name=order[i]; if (v[name]=="n") print "# " name " is not set"; else print name "=" v[name] } }
' > "$seed"

cp "$seed" "$BLD/.config"
# "yes" gets SIGPIPE when conf exits; that is expected.
( yes "" 2>/dev/null || true ) | "$MAKE" -C "$SRC" O="$BLD" HOSTCC="$HOSTCC" oldconfig >"$BLD/.oldconfig.log" 2>&1 \
	|| { tail -30 "$BLD/.oldconfig.log" >&2; echo "mkconfig: oldconfig failed" >&2; exit 1; }

# verify that every requested value survived
bad=0
while IFS= read -r line; do
	case "$line" in
	"# "*" is not set")
		name=${line#\# }; name=${name% is not set}
		if grep -q "^$name=" "$BLD/.config"; then
			echo "mkconfig: wanted $name off, got: $(grep "^$name=" "$BLD/.config")" >&2; bad=1
		fi ;;
	*)
		if ! grep -qxF -- "$line" "$BLD/.config"; then
			name=${line%%=*}
			echo "mkconfig: wanted $line, got: $(grep -E "^(# )?$name[= ]" "$BLD/.config" || echo '<absent>')" >&2; bad=1
		fi ;;
	esac
done < "$seed"
[ "$bad" = 0 ] || { echo "mkconfig: some requested settings were not honoured (see above)" >&2; exit 1; }
echo "mkconfig: wrote $BLD/.config ($(grep -c '=y$' "$BLD/.config") symbols =y)"
