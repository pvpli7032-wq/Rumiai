import requests, urllib3
urllib3.disable_warnings()
for url in ["https://lh.y-98.cn/","https://lh.y-98.cn/admin","https://example.com/","https://www.baidu.com/"]:
    try:
        r=requests.get(url, verify=False, timeout=15, allow_redirects=False)
        print(url, r.status_code, r.headers.get("Server"), r.headers.get("Content-Type"), len(r.content), r.text[:80].replace("\n"," "))
    except Exception as e:
        print(url,"ERR",type(e).__name__,str(e)[:150])
