import requests, urllib3
urllib3.disable_warnings()
paths=["/login","/static/","/static/js/","/api/panel/get_info","/api/panel/login","/index.php","/btwaf","/robots.txt","/.well-known/acme-challenge/","/admin","/panel","/site","/favicon.ico","/login?redirect=/"]
for p in paths:
    try:
        r=requests.get("https://43.242.194.115:21631"+p, verify=False, timeout=8, allow_redirects=False)
        print(p, r.status_code, len(r.content), dict(list(r.headers.items())[:3]))
    except Exception as e:
        print(p,"ERR",type(e).__name__,str(e)[:60])
