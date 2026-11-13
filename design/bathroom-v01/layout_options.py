from pathlib import Path
from html import escape
import json
ROOT=Path(__file__).resolve().parent
p=[]
STONE='#ded8cb';WOOD='#c4a57a';ACCENT='#8a8a7b';WHITE='#fafbf7';MIRROR='#bdd7d5';INK='#354943'
def rect(x,y,w,h,f,stroke='none',sw=1,rx=0):p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f}" stroke="{stroke}" stroke-width="{sw}" rx="{rx}"/>')
def path(pts,c=INK,sw=1.2,fill='none',dash=''):
 d=' '.join(('M' if i==0 else 'L')+f'{x:.2f} {y:.2f}' for i,(x,y) in enumerate(pts))
 p.append(f'<path d="{d}" fill="{fill}" stroke="{c}" stroke-width="{sw}" stroke-dasharray="{dash}"/>')
def line(x,y,X,Y,c=INK,sw=1.2,dash=''):path([(x,y),(X,Y)],c,sw,dash=dash)
def text(x,y,s,size=21,c=INK,bold=False):p.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{700 if bold else 400}" fill="{c}">{escape(str(s))}</text>')
def circ(x,y,r,c,stroke='none',sw=1):p.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}" stroke="{stroke}" stroke-width="{sw}"/>')
def outline(x,y,w,h,c=WOOD,dash='6 4'):path([(x,y),(x+w,y),(x+w,y+h),(x,y+h),(x,y)],c,2,dash=dash)
def dim(x,y,w,label):
 line(x,y,x+w,y,'#75837c')
 for X in [x,x+w]:line(X,y-5,X,y+5,'#75837c')
 text(x+w/2-len(label)*5,y-9,label,18)
V=[
 {'id':'A','title':'ОТДЕЛЬНЫЕ БЛОКИ','sub':'Ближе к исходной расстановке','vanity':[0,800,450,600],'washer':[1150,1920,650,550],'frame':[0,1480,200,690],'wc':[200,1550,520,360],'upper':[[0,1480,300,690],[1150,2170,650,300]],'spots':[[900,1050],[950,1850]],'mirror':[0,800,0,1400],'counts':['1 тумба + 2 верхних шкафа','1 зеркало · 1 стеклянная шторка','1 камень на стенах и полу','3 деревянных мебельных объёма'],'notes':['Раковина слева, WC ниже по той же стене.','Стиралка отдельно в правом нижнем углу.','Люк стиралки и зона перед WC пересекаются.'],'elev':'Левая стена · длина 2470*'},
 {'id':'B','title':'ОБЩАЯ СТОЛЕШНИЦА','sub':'Большой блок на торцевой стене','vanity':[300,1820,800,650],'washer':[1150,1820,650,650],'frame':[0,800,200,690],'wc':[200,965,520,360],'upper':[[300,2170,1500,300]],'spots':[[1000,1050],[1050,1600]],'mirror':[300,2470,1800,2470],'counts':['1 тумба + 1 широкий зеркальный шкаф','1 столешница · 1 ниша стиралки','1 камень на стенах и полу','1 деревянный мебельный блок'],'notes':['Раковина и стиралка собраны внизу плана.','WC перенесён выше по левой стене.','Нужно проверить высоту раковины над тумбой.'],'elev':'Торцевая стена · длина 1800*'},
 {'id':'C','title':'ДЛИННЫЙ БЛОК СЛЕВА','sub':'Исследовательский вариант','vanity':[0,800,650,600],'washer':[0,1420,650,650],'frame':[1110,2270,690,200],'wc':[1275,1750,360,520],'upper':[[1110,2170,690,300]],'spots':[[1050,1000],[1050,1700]],'mirror':[0,800,0,1400],'counts':['1 тумба + 1 шкаф над WC','1 столешница · 1 ниша стиралки','2 камня: фон + зона ванны','2 деревянных мебельных объёма'],'notes':['Раковина и стиралка стоят слева в ряд.','WC на торце напротив стиралки.','Между блоком и чашей только 625 мм*.'],'elev':'Левая стена · длина 2470*'}]
p.append('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2040" viewBox="0 0 2000 2040">')
rect(0,0,2000,2040,'#f5f3ee')
text(50,60,'САНУЗЕЛ / ТРИ КОМПОЗИЦИИ',39,bold=True)
text(50,101,'Сравниваем расстановку, количество объёмов и зоны материалов. Коллекции и цены пока откладываем.',24)
rect(50,123,1900,49,'#eee2c7');text(66,155,'* Контур 1800 × 2470 мм, высота 2700 мм — предположение. Схемы не подтверждают возможность монтажа.',22,'#795c33')
for i,v in enumerate(V):
 x=50+i*645
 rect(x,195,610,1585,'#ffffff','#dfdfd8')
 rect(x+20,215,44,44,INK,rx=4);text(x+31,247,v['id'],29,'#ffffff',True)
 text(x+80,246,v['title'],25,bold=True);text(x+20,285,v['sub'],21,'#6a7971')
 ox=x+65;oy=350;s=.205
 def pt(a,b):return ox+a*s,oy+b*s
 def r(a,b,w,h,f,stroke=INK,sw=1,rx=0):rect(*pt(a,b),w*s,h*s,f,stroke,sw,rx)
 r(0,0,1800,2470,STONE,'none')
 for xx in [600,1200]:line(*pt(xx,0),*pt(xx,2470),'#c6c0b4',.8)
 for yy in [600,1200,1800,2400]:line(*pt(0,yy),*pt(1800,yy),'#c6c0b4',.8)
 # Common anchors: bath, entry and provisional services reserve.
 r(0,0,1700,700,WHITE,rx=6);r(90,90,1520,520,'#e1ece8','#9db0a7',1,18)
 text(*pt(550,400),'ВАННА',20)
 r(0,2170,300,300,'#a8afa8');text(*pt(38,2350),'СТ*',15)
 # Keep one hinged-free fixed glass screen in every layout.
 line(*pt(0,700),*pt(650,700),'#619c9a',5)
 r(*v['frame'],STONE)
 r(*v['vanity'],WOOD)
 vx,vy,vw,vd=v['vanity'];r(vx+60,vy+80,vw-120,vd-160,WHITE,'#9caaa2',1,8)
 text(*pt(vx+vw/2-80,vy+vd/2+35),'Р',19)
 r(*v['washer'],'#eff2ef')
 wx,wy,ww,wd=v['washer'];text(*pt(wx+ww/2-150,wy+wd/2+40),'СМ',21,bold=True)
 if i<2:
  line(*pt(wx+50,wy),*pt(wx+ww-50,wy),'#548ca3',4)
  outline(*pt(wx,wy-500),ww*s,500*s,'#c18b49')
 else:
  line(*pt(wx+ww,wy+40),*pt(wx+ww,wy+wd-40),'#548ca3',4)
  outline(*pt(wx+ww,wy),500*s,wd*s,'#c18b49')
 r(*v['wc'],WHITE,rx=15)
 tx,ty,tw,td=v['wc'];text(*pt(tx+tw/2-90,ty+td/2+30),'WC',16)
 for a,b,w,h in v['upper']:outline(*pt(a,b),w*s,h*s,'#967a55')
 if i==1:outline(*pt(300,1820),1500*s,650*s,INK,'3 3')
 if i==2:outline(*pt(0,800),650*s,1270*s,INK,'3 3')
 # Room boundary, unchanged entry on east wall.
 for a,b,c,d in [(0,0,1800,0),(0,0,0,2470),(0,2470,1800,2470),(1800,0,1800,850),(1800,1750,1800,2470)]:line(*pt(a,b),*pt(c,d),INK,4)
 line(*pt(1800,1750),*pt(2400,1750),'#87978e',1.3)
 text(*pt(1910,1210),'ВХОД',18)
 text(*pt(1900,1340),'900*',17,'#6c7e73')
 if i==2:
  for a,b,c,d in [(0,0,1800,0),(0,0,0,700),(1800,0,1800,700)]:line(*pt(a,b),*pt(c,d),ACCENT,10)
  dim(*pt(650,2110),625*s,'625*')
 mx,my,MX,MY=v['mirror'];line(*pt(mx,my),*pt(MX,MY),MIRROR,7)
 for a,b in v['spots']:circ(*pt(a,b),9,'#ffe6a2','#bb914d',1.2)
 if i==2:line(*pt(600,140),*pt(1200,140),'#ddad53',5)
 dim(ox,oy-20,1800*s,'1800*')
 text(x+20,887,'ПЛАН · сверху ванна, вход справа',19,'#60766b',True)
 for j,t in enumerate(v['counts']):text(x+20,925+j*31,t,21,bold=j==0)
 for j,t in enumerate(v['notes']):text(x+20,1075+j*27,t,18,'#856333' if j==2 else INK)
 # Elevations share 0.12 px/mm; derive furniture extents from plan arrays.
 text(x+20,1188,v['elev'],21,bold=True)
 es=.12;length=1800 if i==1 else 2470;ex=x+(610-length*es)/2;ey=1215;ground=ey+2700*es
 rect(ex,ey,length*es,2700*es,STONE)
 def er(pos,z,w,h,f,stroke=INK):rect(ex+pos*es,ground-(z+h)*es,w*es,h*es,f,stroke,.8)
 if i==1:
  er(0,0,300,2700,'#a8afa8');er(300,350,800,500,WOOD)
  er(1150,0,600,850,WHITE);circ(ex+1450*es,ground-430*es,23,'#dce5e0',INK)
  er(300,880,1500,25,WHITE);er(410,905,520,40,WHITE)
  er(300,1200,1500,1100,MIRROR)
  for pos in [800,1300]:line(ex+pos*es,ground-1200*es,ex+pos*es,ground-2300*es,'#91aaa3')
  line(ex+300*es,ground-2320*es,ex+1800*es,ground-2320*es,'#eac36e',4)
 else:
  if i==2:er(0,0,700,2700,ACCENT)
  er(0,0,700,600,WHITE);line(ex+700*es,ground-600*es,ex+700*es,ground-2000*es,'#7ca7a5',2)
  er(800,350,600,500,WOOD);er(800,850,600,25,WHITE)
  er(800,1100,600,1000,MIRROR)
  for pos in [800,1400]:line(ex+pos*es,ground-1100*es,ex+pos*es,ground-2100*es,'#eac36e',3)
  if i==0:
   er(1480,0,690,1200,STONE);er(1480,1300,690,1100,WOOD);er(1550,200,360,230,WHITE)
   er(1650,950,240,150,'#9da9a2')
  else:
   er(1420,0,600,850,WHITE);circ(ex+1720*es,ground-430*es,23,'#dce5e0',INK)
   er(800,880,1270,25,WHITE)
  er(2170,0,300,2700,'#a8afa8')
 line(ex,ground,ex+length*es,ground,INK,2)
 text(x+20,1576,'СВЕТ · отдельные сценарии',20,bold=True)
 lights=[['2 потолочных + 2 у зеркала + 1 ночной','3 группы: основной / зеркало / ночь'],['2 потолочных + 1 над зеркалом + 1 ночной','3 группы: основной / зеркало / ночь'],['2 потолочных + 2 у зеркала + 1 ночной','+ 1 линия у ванны · итого 4 группы']][i]
 for j,t in enumerate(lights):text(x+20,1610+j*29,t,19)
 text(x+20,1685,'МАТЕРИАЛЫ · зоны, не коллекции',20,bold=True)
 for j,(c,label) in enumerate([(STONE,'Камень-фон'),(WOOD,'Мебель'),(MIRROR,'Зеркало')]):
  rect(x+20+j*190,1708,20,20,c,INK,.5);text(x+48+j*190,1725,label,17)
 if i==2:text(x+20,1760,'Второй камень: стена за ванной и её боковые зоны.',17)
text(50,1830,'КАК ЧИТАТЬ И ЧТО ЕЩЁ ПРОВЕРИТЬ',27,bold=True)
text(50,1870,'Коричневый пунктир — верхние шкафы. Охристый — резерв для открытого люка СМ. Жёлтые круги — потолочный свет.',21)
text(50,1904,'Питание во всех схемах: СМ + розетка у зеркала; отдельные выводы зеркала и подсветки. Точки и мокрые зоны уточняются.',21)
text(50,1938,'Полотенцесушитель, вытяжка, бойлер и люки требуют отдельной проверки размещения; на этих схемах ещё не расставлены.',21,'#856333')
text(50,1983,'A / B / C — гипотезы, а не утверждённые планировки. Положение стояка, трассы слива, обмеры и дверцы мебели нужно проверить.',21,'#856333')
p.append('</svg>')
(ROOT/'bathroom-layout-options.svg').write_text('\n'.join(p))
(ROOT/'bathroom-layout-options.json').write_text(json.dumps({'units':'mm','status':'Exploratory alternatives, not measured or approved','room_assumption':[1800,2470,2700],'fixed_bath':[0,0,1700,700],'shaft_assumption':[0,2170,300,300],'variants':V},ensure_ascii=False,indent=2))
# Verify footprint bounds only; operating zones and plumbing remain unresolved.
for v in V:
 for key in ['vanity','washer','frame','wc']:
  x,y,w,d=v[key];assert x>=0 and y>=0 and x+w<=1800 and y+d<=2470,(v['id'],key)
print('3 variants: footprint bounds verified; plumbing and operating clearances not approved.')
