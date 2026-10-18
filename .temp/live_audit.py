import requests, urllib3, re, json
urllib3.disable_warnings()
B="https://lh.y-98.cn"
s=requests.Session()
def get(p, **kw):
    try:
        r=s.get(B+p, timeout=25, verify=False, allow_redirects=False, **kw)
        return r
    except Exception as e:
        return None
paths=["/","/zh","/en","/th","/admin","/admin/finance","/finance","/moderation","/discover","/chat","/shop","/me","/login","/register","/api/site","/api/operations/status","/robots.txt","/sitemap.xml","/manifest.webmanifest"]
for p in paths:
    r=get(p)
    if r is None:
        print(p,"ERR"); continue
    loc=r.headers.get("Location","")
    print(f"{p:32s} {r.status_code} len={len(r.content):7d} loc={loc}")
print("\n=== /zh title & key copy ===")
r=get("/zh")
txt=r.text
for pat in [r"<title>(.*?)</title>", r"测试", r"Khui", r"星伴", r"领取测试金币"]:
    m=re.findall(pat, txt, re.S)
    print(pat, "->", m[:3] if m else "none")
print("\n=== /admin title ===")
r=get("/admin")
print(re.findall(r"<title>(.*?)</title>", r.text, re.S)[:1])
print("has 星伴管理中心:", "星伴管理中心" in r.text)
print("has 未登录:", "未登录" in r.text)
