from pathlib import Path
from html import escape
import random
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
text(50,62,'САНУЗЕЛ / ВЫБОР ОТДЕЛКИ',38,bold=True)
text(50,100,'Три материала в одной расстановке · ванна + подвесная тумба + подвесной WC',24)
rect(50,123,1900,48,'#eee2c7')
text(68,155,'Условная модель 1800 × 2470 × 2700 мм. Обмеров нет. Это сравнение отделки, не рабочая раскладка.',22,'#785a30')
options=[('A','МАТОВЫЙ КАМЕНЬ','Керамогранит 600 × 1200 мм','#d5cdbf'),('B','ГЛАЗУРЬ + КАМЕНЬ','Керамика 100 × 300 мм в зоне ванны','#647c70'),('C','БЕСШОВНЫЕ СТЕНЫ','Микроцемент для влажных помещений','#c8c1b5')]
for i,(letter,title,subtitle,col) in enumerate(options):
 x=50+645*i
 rect(x,194,610,1085,'#ffffff','#e0dfd8')
 rect(x+20,214,43,43,'#354a44',rx=5);text(x+31,245,letter,29,'#ffffff',True)
 text(x+80,245,title,25,bold=True);text(x+20,281,subtitle,21)
 text(x+20,315,'Развёртка стены: ванна → тумба → WC',19,'#71807c')
 ex=x+45;ey=357;s=.21;w=2470*s;h=2700*s
 stone(ex,ey,w,h)
 if i==0:grid(ex,ey,w,h,126,252,'#aaa397')
 if i==1:
  grid(ex,ey,w,h,126,252,'#aaa397')
  rng=random.Random(2)
  for tx in range(8):
   for ty in range(9):
    cl=rng.choice(['#6d8377','#72887c','#607a6b','#7f9184'])
    rect(ex+tx*21,ey+ty*63,20,62,cl)
    line(ex+tx*21+3,ey+ty*63+4,ex+tx*21+3,ey+ty*63+54,'#91a396',1)
 if i==2:
  rect(ex,ey,w,h,col)
  rng=random.Random(12)
  for k in range(90):
   xx=ex+rng.uniform(4,w-50);yy=ey+rng.uniform(5,h-5)
   line(xx,yy,xx+rng.uniform(10,45),yy-2,'#c2bbae',.7)
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
 rect(ex+1480*s,floor-1200*s,690*s,1200*s,('#d5cdbf' if i==1 else col),'#9c9e94')
 if i!=2:line(ex+1480*s,floor-600*s,ex+2170*s,floor-600*s,'#aaa397')
 wood(ex+1480*s,floor-2400*s,690*s,1100*s)
 line(ex+1825*s,floor-2400*s,ex+1825*s,floor-1300*s,'#88785e')
 rect(ex+1630*s,floor-1070*s,240*s,150*s,'#9ca6a2','#667773',1,3)
 rect(ex+1550*s,floor-430*s,360*s,230*s,'#fbfcf8','#8d9994',1.2,18)
 rect(ex+2170*s,ey,300*s,h,'#bdbbb2','#929c94')
 line(ex,floor,ex+w,floor,'#5a6862',2)
 dim(ex,ey-13,w,'2470 мм*')
 text(x+20,953,'Ванна 1700 × 700* · тумба 600 × 450*',20)
 text(x+20,980,'Белая сантехника · дуб · сатиновый металл',19,'#667771')
 # Floor plan: same outline and fixtures for each comparison.
 px=x+35;py=1010;ps=.078
 stone(px,py,1800*ps,2470*ps);grid(px,py,1800*ps,2470*ps,47,47,'#aaa397')
 rect(px,py,1700*ps,700*ps,'#f6f7f3','#748780',1,5)
 rect(px+8,py+8,1700*ps-16,700*ps-16,'#dde5e1',rx=9)
 wood(px,py+800*ps,450*ps,600*ps)
 rect(px,py+1480*ps,200*ps,690*ps,('#d5cdbf' if i==1 else col),'#829087')
 rect(px+200*ps,py+1550*ps,520*ps,360*ps,'#ffffff','#829087',1,10)
 rect(px+1150*ps,py+1920*ps,650*ps,550*ps,'#edf0ed','#829087')
 rect(px,py+2170*ps,300*ps,300*ps,'#a4aaa4')
 for a,b,c,d in [(0,0,1800,0),(0,0,0,2470),(0,2470,1800,2470),(1800,0,1800,850),(1800,1750,1800,2470)]:line(px+a*ps,py+b*ps,px+c*ps,py+d*ps,'#43554c',3)
 if i==1:
  line(px,py,px+1800*ps,py,'#647c70',6);line(px,py,px,py+800*ps,'#647c70',6)
 text(px+153,py+92,'← вход',17,'#67796f')
 text(px,py+218,'План: пол во всех вариантах — керамогранит 600 × 600',17)
 details=[['Стены: крупная матовая плитка','Рисунок: спокойный известняк','Швы: в тон, по паспорту плитки','Акцент: дубовая мебель'],['Акцент: глазурованная керамика','Стена ванны + боковые возвраты','Остальное: матовый керамогранит','Больше швов и бликов'],['Стены: единая система покрытия','Финиш: матовый защитный слой','Пол: отдельный керамогранит','Образец выкрасить до монтажа']][i]
 for k,t in enumerate(details):text(x+260,1030+k*36,t,18)
text(50,1327,'ОБЩАЯ ОСНОВА СПЕЦИФИКАЦИИ · ПРЕДЛОЖЕНИЕ',27,bold=True)
for x,title,rows in [(50,'СВЕТ',['Основной: 3000 K, CRI ≥ 90','У зеркала: отдельный фронтальный свет','Ночь: низкая подсветка под тумбой']),(700,'УЗЛЫ И ОБСЛУЖИВАНИЕ',['Гидроизоляция + ленты примыканий','Доступ к сифону, арматуре и драйверам','45° / защитный профиль — выбрать отдельно']),(1350,'ЭЛЕКТРИКА',['Потребители: стиралка, зеркало, полотенцесушитель','Блоки питания — с доступом для замены','Координаты розеток — после проверки мокрых зон'])]:
 text(x,1370,title,22,bold=True)
 for j,r in enumerate(rows):text(x,1405+j*33,r,19)
text(50,1545,'Все три варианта сохраняют одну геометрию. Фактура и цвет условные; образцы проверяем при одинаковом свете.',22,'#6d786f')
text(50,1581,'* Линейные размеры — предположение. Артикулы, расход, раскладка швов и стоимость пока не утверждены.',21,'#8b6a3b')
p.append('</svg>')
(ROOT/'bathroom-finish-choices.svg').write_text('\n'.join(p))
