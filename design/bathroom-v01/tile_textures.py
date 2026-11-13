from pathlib import Path
from html import escape
import random, math
ROOT=Path(__file__).resolve().parent
p=[]
def rect(x,y,w,h,f,stroke='none',sw=1,rx=0):p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f}" stroke="{stroke}" stroke-width="{sw}" rx="{rx}"/>')
def line(x,y,X,Y,c='#aca69c',sw=1):p.append(f'<path d="M{x} {y} L{X} {Y}" fill="none" stroke="{c}" stroke-width="{sw}"/>')
def text(x,y,s,size=21,c='#2d3839',bold=False):p.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{700 if bold else 400}" fill="{c}">{escape(s)}</text>')
def stone(x,y,w,h,base='#d5cdbf'):
 rect(x,y,w,h,base)
 rng=random.Random(31)
 for _ in range(int(w*h/700)):
  xx=x+rng.uniform(2,w-2); yy=y+rng.uniform(2,h-2)
  line(xx,yy,min(x+w,xx+rng.uniform(1,6)),yy,'#c7bfb2',.6)
def finish(x,y,w,h,kind):
 rect(x,y,w,h,['#d8d3c8','#d6c9b5','#d2d0c8'][kind])
 rng=random.Random(82)
 if kind==0:
  for _ in range(int(w*h/140)):
   xx=x+rng.uniform(1,w-2);yy=y+rng.uniform(1,h-2)
   line(xx,yy,min(x+w,xx+rng.uniform(1,4)),yy,rng.choice(['#c7c3b8','#e0dcd2','#cec9bd']),.7)
 elif kind==1:
  for j in range(3,int(h)-4,4):
   pts=[]
   for k in range(0,int(w)+1,5):pts.append((x+k,y+j+1.5*math.sin(k/27+j/9)))
   d=' '.join(('M' if n==0 else 'L')+f'{a:.1f} {b:.1f}' for n,(a,b) in enumerate(pts))
   p.append(f'<path d="{d}" fill="none" stroke="{rng.choice(["#c7baa5","#ded3c1","#cbbda9"])}" stroke-width="{rng.uniform(.3,1.2):.1f}"/>')
 else:
  for _ in range(int(w*h/85)):
   xx=x+rng.uniform(3,w-8);yy=y+rng.uniform(3,h-8);a=rng.uniform(1,3.8);b=rng.uniform(1,3.8)
   d=f'M{xx} {yy} L{xx+a} {yy-1} L{xx+a*1.5} {yy+b} L{xx} {yy+b+1} Z'
   p.append(f'<path d="{d}" fill="{rng.choice(["#aca99e","#b8b1a5","#ebe6dc","#8f9189","#bbb6ac"])}" stroke="none"/>')
def grid(x,y,w,h,tw,th,c):
 for dx in range(tw,int(w),tw):line(x+dx,y,x+dx,y+h,c,.8)
 for dy in range(th,int(h),th):line(x,y+dy,x+w,y+dy,c,.8)
def wood(x,y,w,h):
 rect(x,y,w,h,'#bda17c')
 for i in range(5,int(w),9):line(x+i,y,x+i,y+h,'#ae926e',.7)
def dim(x,y,w,label):
 line(x,y,x+w,y,'#7e8987')
 for X in [x,x+w]:line(X,y-5,X,y+5,'#7e8987')
 text(x+w/2-65,y-9,label,19)
p.append('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1630" viewBox="0 0 2000 1630">')
rect(0,0,2000,1630,'#f5f3ee')
text(50,62,'САНУЗЕЛ / ВЫБОР ФАКТУРЫ',38,bold=True)
text(50,100,'Выбрано: матовый керамогранит + эпоксидная затирка · сравниваем рисунок стен',24)
rect(50,123,1900,48,'#eee2c7')
text(68,155,'Условная модель 1800 × 2470 × 2700 мм. Обмеров нет. Это сравнение отделки, не рабочая раскладка.',22,'#785a30')
options=[('1','СПОКОЙНЫЙ КАМЕНЬ','Мелкозернистый, без активных прожилок','#d8d3c8'),('2','ТРАВЕРТИН','Горизонтальные слои, тёплый оттенок','#d6c9b5'),('3','МЕЛКОЕ ТЕРРАЦЦО','Минеральные включения, серо-бежевый','#d2d0c8')]
for i,(letter,title,subtitle,col) in enumerate(options):
 x=50+645*i
 rect(x,194,610,1085,'#ffffff','#e0dfd8')
 rect(x+20,214,43,43,'#354a44',rx=5);text(x+31,245,letter,29,'#ffffff',True)
 text(x+80,245,title,25,bold=True);text(x+20,281,subtitle,21)
 text(x+20,315,'Развёртка стены: ванна → тумба → WC',19,'#71807c')
 ex=x+45;ey=357;s=.21;w=2470*s;h=2700*s
 finish(ex,ey,w,h,i)
 grid(ex,ey,w,h,126,252,'#b6b0a4')
 floor=ey+h
 # Side elevation uses the existing provisional plan, in millimetres.
 rect(ex,floor-600*s,700*s,600*s,'#f3f4f1','#8d9994',1.2,4)
 rect(ex+8,floor-590*s,700*s-16,18,'#ffffff')
 line(ex+700*s,floor-600*s,ex+700*s,floor-2000*s,'#a5c3c5',3)
 wood(ex+800*s,floor-850*s,600*s,500*s)
 rect(ex+800*s,floor-875*s,600*s,25*s,'#f6f7f2','#a6b0aa')
 line(ex+1100*s,floor-870*s,ex+1100*s,floor-1030*s,'#6f7d7c',5)
 rect(ex+800*s,floor-2100*s,600*s,1000*s,'#d9e3e1','#acbab5')
 for xx in [ex+800*s,ex+1400*s]:line(xx,floor-2100*s,xx,floor-1100*s,'#f7eac6',5)
 finish(ex+1480*s,floor-1200*s,690*s,1200*s,i)
 line(ex+1480*s,floor-600*s,ex+2170*s,floor-600*s,'#aaa397')
 wood(ex+1480*s,floor-2400*s,690*s,1100*s)
 line(ex+1825*s,floor-2400*s,ex+1825*s,floor-1300*s,'#88785e')
 rect(ex+1630*s,floor-1070*s,240*s,150*s,'#9ca6a2','#667773',1,3)
 rect(ex+1550*s,floor-430*s,360*s,230*s,'#fbfcf8','#8d9994',1.2,18)
 finish(ex+2170*s,ey,300*s,h,i)
 line(ex+2170*s,ey,ex+2170*s,floor,'#929c94')
 line(ex,floor,ex+w,floor,'#5a6862',2)
 dim(ex,ey-13,w,'2470 мм*')
 text(x+20,953,'Ванна 1700 × 700* · тумба 600 × 450*',20)
 text(x+20,980,'Белая сантехника · дуб · сатиновый металл',19,'#667771')
 # Enlarged illustrative swatch; not a scan of a commercial tile.
 finish(x+25,1010,200,125,i)
 text(x+25,1164,'Образец рисунка',18)
 details=[['Спокойный фон для дуба','Меньше визуального шума','Мой основной кандидат'],['Слои продолжаем по стене','Подбираем соседние «лица»','Проверяем глубину рельефа'],['Более активные поверхности','Мебель оставляем спокойной','Рисунок не задаёт направление']][i]
 for k,t in enumerate(details):text(x+250,1037+k*36,t,19)
 text(x+25,1212,'Общий пол: спокойный матовый камень, формат пока 60 × 60.',18)
 text(x+25,1244,'Схема рисунка условная — это не фото выбранного артикула.',18,'#8b6a3b')
text(50,1327,'ДЛЯ ЧЕСТНОГО СРАВНЕНИЯ',27,bold=True)
for x,title,rows in [(50,'СВЕТ',['Основной: 3000 K, CRI ≥ 90','У зеркала: отдельный фронтальный свет','Ночь: низкая подсветка под тумбой']),(700,'ПРОБНЫЙ ОБРАЗЕЦ',['Плитка + выбранная эпоксидная затирка','Проверяем цвет и очистку поверхности','Запил 45° оцениваем на отдельном обрезке']),(1350,'ЭЛЕКТРИКА',['Потребители: стиралка, зеркало, полотенцесушитель','Блоки питания — с доступом для замены','Координаты розеток — после проверки мокрых зон'])]:
 text(x,1370,title,22,bold=True)
 for j,r in enumerate(rows):text(x,1405+j*33,r,19)
text(50,1545,'Геометрия, мебель и палитра света одинаковые. Фактура условная; это схема, а не светотехнический расчёт.',22,'#6d786f')
text(50,1581,'* Линейные размеры — предположение. Артикулы, расход, раскладка швов и стоимость пока не утверждены.',21,'#8b6a3b')
p.append('</svg>')
(ROOT/'bathroom-tile-textures.svg').write_text('\n'.join(p))
