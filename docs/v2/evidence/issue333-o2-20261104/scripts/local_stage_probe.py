import sys, time, json
from pathlib import Path
sys.path.insert(0, r"D:\dev\afldb\tools\migration")
import add_match_coaches_2026 as w
t = time.time()
staging = Path(sys.argv[1])
info = w.stage_core(Path(r"D:\tmp\coach2026\core.tar"), staging)
print("staged", info["files"], info["setDigest"][:16], round(time.time() - t, 1))
src = w.read_source(staging)
a = src["assignments"]
print({k: v for k, v in src.items() if k not in ("assignments", "names")})
print("assignments", len(a), "2026", sum(1 for k in a if k[1] == 2026))
from collections import Counter
print(Counter(src["names"][v] for k, v in a.items() if k[1] == 2026).most_common(25))
print("elapsed", round(time.time() - t, 1))
