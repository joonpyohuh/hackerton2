"""Reload the analysis snapshot: python -m backend.import_snapshot [path/to/data.js]"""
import json,sys
from . import db
with db.connect() as c:
    print(json.dumps(db.import_snapshot(c,sys.argv[1] if len(sys.argv)>1 else None),ensure_ascii=False))
