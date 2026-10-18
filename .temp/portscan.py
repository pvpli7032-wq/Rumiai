import socket
HOST="43.242.194.115"
ports=[21,22,80,443,888,8888,8443,2087,2096,21631,3000,3306,6379,5432]
for p in ports:
    s=socket.socket(); s.settimeout(4)
    try:
        s.connect((HOST,p)); print(p,"OPEN")
    except Exception as e:
        print(p,"closed")
    finally:
        s.close()
print("--- dns ---")
try:
    print(socket.gethostbyname("lh.y-98.cn"))
except Exception as e:
    print("dns err", e)
