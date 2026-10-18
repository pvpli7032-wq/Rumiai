import requests, urllib3, json
urllib3.disable_warnings()
BASE="https://43.242.194.115:21631"
s=requests.Session()
tests=[
 ("POST","/login",{"username":"xvbkiqus","password":"c9be5189"}),
 ("POST","/api/panel/login",{"username":"xvbkiqus","password":"c9be5189"}),
 ("GET","/login",None),
 ("POST","/login?tmp_token=",{"username":"xvbkiqus","password":"c9be5189"}),
 ("POST","/766cd832/login",{"username":"xvbkiqus","password":"c9be5189"}),
 ("POST","/766cd832",{"username":"xvbkiqus","password":"c9be5189"}),
]
for m,p,d in tests:
    try:
        if m=="POST":
            r=s.post(BASE+p, data=d, verify=False, timeout=15, allow_redirects=False)
        else:
            r=s.get(BASE+p, verify=False, timeout=15, allow_redirects=False)
        print(m,p,r.status_code,len(r.content),repr(r.text[:120]))
    except Exception as e:
        print(m,p,"ERR",type(e).__name__,str(e)[:80])
