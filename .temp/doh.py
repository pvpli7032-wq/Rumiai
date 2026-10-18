import requests, urllib3, json
urllib3.disable_warnings()
proxies={"https":"http://127.0.0.1:7890","http":"http://127.0.0.1:7890"}
for name in ["lh.y-98.cn","www.y-98.cn","y-98.cn"]:
    for rt in ["A","CNAME"]:
        try:
            r=requests.get("https://1.1.1.1/dns-query", params={"name":name,"type":rt}, headers={"accept":"application/dns-json"}, proxies=proxies, timeout=15, verify=False)
            d=r.json()
            print(name, rt, [ (a.get("data"), a.get("TTL")) for a in d.get("Answer",[]) ])
        except Exception as e:
            print(name, rt, "ERR", type(e).__name__, str(e)[:100])
print("--- direct (no proxy) ---")
try:
    r=requests.get("https://1.1.1.1/dns-query", params={"name":"lh.y-98.cn","type":"A"}, headers={"accept":"application/dns-json"}, timeout=15, verify=False)
    print(r.json().get("Answer"))
except Exception as e:
    print("ERR", type(e).__name__, str(e)[:120])
