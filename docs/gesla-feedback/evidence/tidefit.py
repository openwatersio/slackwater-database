import numpy as np, datetime as dt, csv, io, os, sys, urllib.request, urllib.parse, json
SPEEDS={'M2':28.9841042,'S2':30.0000000,'N2':28.4397295,'K1':15.0410686,'O1':13.9430356,'K2':30.0821373,'M4':57.9682084}
G40='/Users/bkeepers/projects/openwaters/tide-database/tmp/GESLA'
def fit(t_hours, y):
    # t in hours since a fixed reference; returns dict name->(amp, phase_deg)
    cols=[np.ones_like(t_hours), t_hours/1e4]
    for s in SPEEDS.values():
        w=np.deg2rad(s); cols+= [np.cos(w*t_hours), np.sin(w*t_hours)]
    A=np.column_stack(cols); x,*_=np.linalg.lstsq(A,y,rcond=None)
    out={}
    for i,n in enumerate(SPEEDS):
        a,b=x[2+2*i],x[3+2*i]; out[n]=(float(np.hypot(a,b)), float(np.degrees(np.arctan2(b,a))%360))
    return out
REF=dt.datetime(2000,1,1,tzinfo=dt.timezone.utc)
def hours(d): return (d-REF).total_seconds()/3600
def load40(fid, t0, t1):
    T=[];Y=[]; null=-99.9999
    for line in open(os.path.join(G40,fid),errors='replace'):
        if line.startswith('#'):
            if 'NULL VALUE' in line: null=float(line.split()[-1])
            continue
        f=line.split()
        if len(f)<5 or f[4]!='1': continue
        d=dt.datetime.strptime(f[0]+' '+f[1],'%Y/%m/%d %H:%M:%S').replace(tzinfo=dt.timezone.utc)
        if d<t0: continue
        if d>=t1: break
        v=float(f[2])
        if abs(v-null)<1e-3: continue
        T.append(hours(d)); Y.append(v)
    return np.array(T),np.array(Y)
def load41(rid, t0, t1):
    q=f'time,sea_level,flag2&record_id="{rid}"&time>={t0:%Y-%m-%dT%H:%M:%SZ}&time<{t1:%Y-%m-%dT%H:%M:%SZ}'
    url='https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_gesla.csv?'+urllib.parse.quote(q,safe='=&<>"')
    try: txt=urllib.request.urlopen(url,timeout=120).read().decode()
    except Exception as e: return np.array([]),np.array([])
    rows=list(csv.reader(io.StringIO(txt)))[2:]
    T=[];Y=[]
    for r in rows:
        if r[2]!='1' or r[1] in ('','NaN'): continue
        v=float(r[1])
        if abs(v+99.9999)<1e-3: continue
        d=dt.datetime.strptime(r[0],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
        T.append(hours(d)); Y.append(v)
    return np.array(T),np.array(Y)
def shift_hours(gold,gnew,speed):
    d=(gold-gnew+180)%360-180
    return d/speed
