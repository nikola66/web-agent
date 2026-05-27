import zipfile
from pathlib import Path
out = Path("bundle.zip")
with zipfile.ZipFile(out, "w") as zf:
    zf.writestr("a.txt", "hi")
