import requests, urllib3, json, pickle, sys, time
urllib3.disable_warnings()
BASE="https://43.242.194.115:21631"

def go(token):
    s=requests.Session()
    r=s.get(BASE+"/login?tmp_token="+token, verify=False, timeout=25)
    print("GET login:", r.status_code, "len", len(r.content))
    print("ALL COOKIES:", s.cookies.get_dict())
    print("SET-COOKIE:", r.headers.get("Set-Cookie"))
    if r.status_code != 200:
        return
    pickle.dump(s.cookies, open(".temp/bt_cookies.pkl","wb"))
    # try common panel APIs
    for name, url, data in [
        ("system","/system?action=GetSystemTotal",{}),
        ("sites","/data?action=getData&table=sites",{"table":"sites","limit":20,"p":1,"search":""}),
        ("sitetype","/site?action=GetSiteTypes",{}),
    ]:
        try:
            rr=s.post(BASE+url, data=data, verify=False, timeout=20)
            print(name, rr.status_code, rr.text[:300])
        except Exception as e:
            print(name,"ERR",type(e).__name__,str(e)[:100])

if __name__=="__main__":
    go(sys.argv[1])
