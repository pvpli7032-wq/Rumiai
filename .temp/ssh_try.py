import paramiko
HOST="43.242.194.115"
cands=["1314520Gao...","1314520Gao","1314520Gao..","1314520Gao.","1314520Gao123","1314520gao..."]
for pwd in cands:
    c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        c.connect(HOST,22,"root",pwd,timeout=15,allow_agent=False,look_for_keys=False)
        print("SUCCESS with:", repr(pwd))
        i,o,e=c.exec_command("hostname; whoami; date")
        print(o.read().decode())
        c.close()
        break
    except Exception as ex:
        print("fail", repr(pwd), type(ex).__name__)
