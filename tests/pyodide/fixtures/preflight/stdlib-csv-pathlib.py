import csv, io
from pathlib import Path
buf = io.StringIO("a,b\n1,2\n")
rows = list(csv.reader(buf))
Path("out").mkdir(exist_ok=True)
