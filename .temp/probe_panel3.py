import requests, urllib3, paramiko
urllib3.disable_warnings()
for host in ["43.242.194.115:21631","lh.y-98.cn:21631","lh.y-98.cn","43.242.194.115"]:
    try:
        r=requests.get("https://43.242.194.115:21631/766cd832", verify=False, timeout=12, headers={"Host":host}, allow_redirects=False)
        print("HOST",host,"->",r.status_code, r.headers.get("Server"), r.text[:100].replace("\n"," "))
    except Exception as e:
        print("HOST",host,"ERR",type(e).__name__,str(e)[:120])
print("--- ssh attempts ---")
for pwd in ["kddsXOLC9832","c9be5189"]:
    c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        c.connect("43.242.194.115",22,"root",pwd,timeout=15,allow_agent=False,look_for_keys=False)
        print("PWD OK:",pwd); c.close(); break
    except Exception as e:
        print("fail",pwd,type(e).__name__)
