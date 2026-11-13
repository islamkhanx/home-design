from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
exec((ROOT/'layout_options.py').read_text().split('V=[')[0])
W,H=2000,1780
p.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">');rect(0,0,W,H,'#f5f3ee')
text(50,64,'A3 / M1 / T1 · КАК ОФОРМИТЬ НАРУЖНЫЙ УГОЛ',37,bold=True)
text(50,107,'Одинаковый светлый камень. Слева — стык двух запиленных плит; справа — защитная металлическая кромка.',23)
text(50,148,'Схематичные крупные планы: толщины и ширины увеличены для наглядности. Это не монтажные чертежи.',21,'#7b786b')
def poly(pts,fill,stroke='#827b6d',sw=1):path(pts+[pts[0]],stroke,sw,fill)
def iso(cx,cy,profile=False):
 O=(cx,cy);L=(cx-270,cy-105);R=(cx+270,cy-105);B=(cx,cy-210);h=350
 poly([L,B,R,O],'#e6dfd1');poly([O,L,(L[0],L[1]+h),(cx,cy+h)],'#c9bfad');poly([O,R,(R[0],R[1]+h),(cx,cy+h)],'#ded5c3')
 for dy in [170]:
  line(cx-270,cy-105+dy,cx,cy+dy,'#a99e8b',2);line(cx,cy+dy,cx+270,cy-105+dy,'#b7ac97',2)
 if profile:
  poly([(cx-9,cy-3.5),O,(cx,cy+h),(cx-9,cy+h-3.5)],'#929e9f','#849091')
  poly([O,(cx+9,cy-3.5),(cx+9,cy+h-3.5),(cx,cy+h)],'#d4dddd','#97a3a4')
  poly([(cx-9,cy-3.5),(cx,cy-7),(cx+9,cy-3.5),O],'#e0e7e5')
 else:line(cx,cy,cx,cy+h,'#8c816e',2)
for i in range(2):
 x=50+i*990;cx=x+450
 text(x+20,220,['У1 · ЗАПИЛ 45°','У2 · ПРЯМОЙ МЕТАЛЛИЧЕСКИЙ ПРОФИЛЬ'][i],29,bold=True)
 iso(cx,440,bool(i))
 text(x+35,827,['Камень визуально оборачивает угол','На углу видна ровная металлическая линия'][i],25,bold=True)
 text(x+35,869,'Сечение сверху · принцип соединения',22)
 ox=x+75;oy=915;t=28;g=6;L=230
 rect(ox+t+12,oy+t+12,L-t-12,L-t-12,'#cbd0c8')
 if i==0:
  poly([(ox+g+4,oy),(ox+L,oy),(ox+L,oy+t),(ox+t+g,oy+t),(ox+g+4,oy+4)],'#ded5c3')
  poly([(ox,oy+g+4),(ox+4,oy+g+4),(ox+t,oy+t+g),(ox+t,oy+L),(ox,oy+L)],'#c9bfad')
  line(ox+24,oy+21,ox+345,oy+65,'#a36f3f',1.5);text(ox+350,oy+69,'Запил с обратной стороны',21)
  text(ox+350,oy+111,'Торцы сходятся под 45°',21)
  text(ox+350,oy+153,'Кромку не сводят «в нож»',21)
 else:
  rect(ox+t+g,oy,L-t-g,t,'#ded5c3','#827b6d');rect(ox,oy+t+g,t,L-t-g,'#c9bfad','#827b6d')
  rect(ox,oy,t,t,'#a8b4b4','#718383');poly([(ox+t-2,oy+t-2),(ox+t+4,oy+t+4),(ox+t+160,oy+t+4),(ox+t+160,oy+t+8),(ox+t+1,oy+t+8),(ox+t-2,oy+t)],'#a8b4b4','#718383',0.5)
  line(ox+14,oy+14,ox+345,oy+65,'#527d8c',1.5);text(ox+350,oy+69,'Профиль закрывает кромки',21)
  text(ox+350,oy+111,'Монтажная полка под плиткой',21)
  text(ox+350,oy+153,'Форма зависит от изделия',21)
 lines=[['Вид: цельный каменный объём','Монтаж: точный рез и обработка обеих кромок','Стойкость: тонкий край требует бережного обращения'],['Вид: аккуратный графичный кант','Монтаж: прямые резы плитки; точная посадка профиля','Стойкость: профиль защищает края от ударов']][i]
 for j,s in enumerate(lines):text(x+35,1193+j*37,s,22,bold=j==0)
line(50,1320,1950,1320,'#cdd2c8')
text(50,1370,'ГДЕ ЭТО В НАШЕЙ A3',28,bold=True)
# Plan fragment with the same canonical footprint, no invented measured dimensions.
m=json.loads((ROOT/'bathroom-a3-tiles.json').read_text());v=m['variants'][0];ox,oy,scale=80,1410,.11
for a,c in [(v['vanity'],WOOD),(v['frame'],STONE),(v['wc'],WHITE)]:
 xx,zz,ww,dd=a;rect(ox+xx*scale,oy+(zz-800)*scale,ww*scale,dd*scale,c,INK,1)
line(ox,oy-5,ox,oy+160,INK,3)
xx,zz,ww,dd=v['frame'];X=ox+(xx+ww)*scale;Y=oy+(zz-800)*scale
line(X,Y,X,Y+dd*scale,'#b67843',5);line(ox,Y,X,Y,'#b67843',5)
text(195,oy+33,'Тумба',20);text(195,oy+103,'WC',20)
text(360,1436,'Выделен доступный наружный угол короба WC рядом с тумбой.',24,bold=True)
text(360,1479,'Здесь сравниваем вертикальную кромку и верхнее переднее ребро короба.',22)
text(360,1522,'Остальные торцы и углы шахты уточним после обмеров и проверки доступа.',22)
text(360,1578,'У ванны и на внутренних примыканиях нужен отдельный узел:',22,bold=True)
text(360,1612,'эпоксидная затирка не заменяет предусмотренные эластичные швы.',22)
text(50,1691,'На рисунке У2 — условный прямой профиль. Материал, отделка и высота подбираются под плитку и условия эксплуатации.',20)
text(50,1732,'Основание: рекомендации RUBI по заусовке и Schlüter по защите кромок. Ни один вариант пока не выбран.',20,'#6b766f')
p.append('</svg>');(ROOT/'bathroom-corner-choices.svg').write_text('\n'.join(p))
