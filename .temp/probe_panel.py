import requests, urllib3, hashlib, json
urllib3.disable_warnings()
base="https://43.242.194.115:21631"
ent="/766cd832"
for path in [ent, ent+"/", "/login", ent+"/login"]:
    try:
        r=requests.get(base+path, verify=False, timeout=15)
        print(path, r.status_code, len(r.text), r.text[:200].replace("\n"," "))
    except Exception as e:
        print(path, "ERR", type(e).__name__, str(e)[:200])
