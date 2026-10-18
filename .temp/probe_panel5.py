import requests, urllib3
urllib3.disable_warnings()
tests=["/766cd832","/login","/static/logo.svg","/favicon.ico","/api/panel/get_info","/site","/public"]
for t in tests:
    try:
        r=requests.get("https://43.242.194.115:21631"+t, verify=False, timeout=10, allow_redirects=False)
        print(t, r.status_code, len(r.content), repr(r.text[:60]))
    except Exception as e:
        print(t,"ERR",type(e).__name__,str(e)[:80])
print("--- with Host lh.y-98.cn ---")
for t in ["/766cd832","/login"]:
    r=requests.get("https://43.242.194.115:21631"+t, verify=False, timeout=10, headers={"Host":"lh.y-98.cn"}, allow_redirects=False)
    print(t, r.status_code, repr(r.text[:60]))
