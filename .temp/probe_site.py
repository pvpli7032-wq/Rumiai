import requests, urllib3
urllib3.disable_warnings()
for u in ["https://lh.y-98.cn/zh","https://lh.y-98.cn/admin"]:
    r=requests.get(u, verify=False, timeout=20, allow_redirects=False)
    print(u, r.status_code, len(r.content))
