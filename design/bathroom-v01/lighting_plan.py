from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
exec((ROOT/'layout_options.py').read_text().split('V=[')[0])
m=json.loads((ROOT/'bathroom-a3-lighting.json').read_text());v=m['variants'][0]
p.append('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1100" viewBox="0 0 2000 1100">')
rect(0,0,2000,1100,'#f5f3ee');text(50,60,'A3 / СВЕТ И ТОЧКИ ПИТАНИЯ',38,bold=True)
text(50,102,'Концептуальная схема: группы и места потребителей. Не план для электромонтажа.',24)
rect(50,125,1900,45,'#eee2c7');text(66,156,'Расположение розеток, IP, защита линий и кабели — после обмеров и проверки применимых электрических зон.',21,'#795c33')
ox,oy,s=115,245,.27
pt=lambda x,z:(ox+x*s,oy+z*s)
def rr(a,c,rx=0):x,z,w,d=a;rect(*pt(x,z),w*s,d*s,c,INK,1,rx)
rr([0,0,1800,2470],STONE);rr(m['fixed_bath'],WHITE,12);rr([90,90,1520,520],'#dce9e4',18)
text(*pt(550,380),'ВАННА',24)
rr(v['vanity'],WOOD);rr(v['frame'],STONE);rr(v['wc'],WHITE,19);rr([1150,1820,650,650],WOOD)
text(*pt(1220,2090),'КОЛОННА',18);text(*pt(1250,2210),'со СМ',18)
rr(m['shaft_assumption'],'#a6b0a7');text(*pt(20,2330),'СТ*',17)
for a,b,c,d in [(0,0,1800,0),(0,0,0,2470),(0,2470,1800,2470),(1800,0,1800,850),(1800,1750,1800,2470)]:line(*pt(a,b),*pt(c,d),INK,4)
text(*pt(1870,1250),'ВХОД',20)
# Ceiling emitters projected onto the floor plan.
for idx,l in enumerate([x for x in m['lighting']['lights'] if x['group']=='G1']):
 x,y,z=l['position_mm'];circ(*pt(x,z),16,'#ffe4a0','#b48a42',2);text(*pt(x+90,z+35),l['id'],20)
line(*pt(0,800),*pt(0,1400),MIRROR,7)
for z in [806,1396]:circ(*pt(60,z),7,'#e5b85b')
text(*pt(210,1150),'G2',23,bold=True)
def badge(x,z,label,c):
 X,Y=pt(x,z);circ(X,Y,21,c);text(X-12*len(label)/2,Y+7,label,19,'#ffffff',True)
badge(1780,2200,'R1','#527d8c');badge(0,1450,'R2','#b47844');badge(1500,2430,'D','#527d8c');badge(2120,1790,'S','#527d8c')
dim(ox,oy-22,1800*s,'1800*')
text(65,960,'* 1800 × 2470 мм — условный контур.',21)
text(65,993,'Высоты розеток пока не назначены.',21)
text(800,225,'2 ГРУППЫ / 4 ИСТОЧНИКА',27,bold=True)
rows=[('G1','2 потолочные точки','Общий свет: вход, уборка, пользование санузлом.'),('G2','2 вертикальные линии у зеркала','Отдельное включение и регулировка яркости.')]
for j,(id,title,desc) in enumerate(rows):
 y=275+j*91;rect(800,y-25,62,39,'#354943',rx=4);text(812,y+2,id,22,'#ffffff',True);text(880,y,title,23,bold=True);text(880,y+33,desc,21)
text(800,585,'ПИТАНИЕ И УПРАВЛЕНИЕ',27,bold=True)
rows=[('R1','1 розетка СМ — в доступном отсеке колонны.'),('R2','Блок из 2 розеток у тумбы — кандидат, проверить зоны.'),('D','Место под драйверы G2 в верхнем отсеке колонны.'),('S','Управление 2 группами снаружи, со стороны коридора.')]
for j,(id,desc) in enumerate(rows):
 y=632+j*60;text(800,y,id,24,bold=True);text(865,y,desc,22)
text(800,904,'Доступ к драйверам — через дверцу шкафа.',23,bold=True)
text(800,941,'Количество, мощность и охлаждение — по выбранным светильникам.',21)
text(800,978,'Предварительная трасса: потолок → отдельные спуски к точкам.',21)
text(50,1052,'Вытяжка, полотенцесушитель и возможный бойлер: питание добавим после выбора их расположения.',22,'#795c33')
p.append('</svg>');(ROOT/'a3-lighting-plan.svg').write_text('\n'.join(p))
