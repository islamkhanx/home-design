from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
exec((ROOT/'layout_options.py').read_text().split('V=[')[0])
m=json.loads((ROOT/'bathroom-a3-tiles.json').read_text());p.append('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1260" viewBox="0 0 2000 1260">');rect(0,0,2000,1260,'#f5f3ee')
text(50,62,'A3 / M1 · РИСУНОК ШВОВ НА ЛЕВОЙ СТЕНЕ',37,bold=True)
text(50,104,'Одна стена, одинаковый масштаб. Контуры сантехники и мебели показаны пунктиром.',24)
rect(50,128,1900,64,'#eee2c7');text(66,155,'2470 × 2700 мм — условные размеры. Числа ниже — ширины модульных полей, не размеры деталей для резки.',21,'#795c33');text(66,180,'Фактические подрезки зависят от обмеров, калибра плитки, швов и примыканий. Шов 2 мм здесь только для сравнения.',20,'#795c33')
for i,v in enumerate(m['variants']):
 x=50+i*650;g=v['tile_grid'];ox=x+35;oy=285;s=.19;w=2470*s;h=2700*s
 text(x+15,235,v['id']+'  '+v['title'],27,bold=True);dim(ox,oy-18,w,'2470*')
 rect(ox,oy,w,h,STONE,INK,2)
 zs=[0]+g['west_vertical_axes_mm']+[2470];ys=[0]+g['horizontal_axes_mm']+[2700]
 for a,b in zip(zs,zs[1:]):
  for c,e in zip(ys,ys[1:]):
   if b-a<g['nominal_width_mm'] or e-c<g['nominal_height_mm']:rect(ox+a*s,oy+(2700-e)*s,(b-a)*s,(e-c)*s,'#e5d3b4')
 for z in zs[1:-1]:line(ox+z*s,oy,ox+z*s,oy+h,'#928772',2)
 for y in ys[1:-1]:line(ox,oy+(2700-y)*s,ox+w,oy+(2700-y)*s,'#928772',2)
 def obj(z,y,w,h,label):
  X=ox+z*s;Y=oy+(2700-y-h)*s;outline(X,Y,w*s,h*s,'#62796f','7 5');text(X+7,Y+22,label,17,'#425f54')
 obj(0,0,700,600,'ванна');obj(800,350,600,525,'тумба');obj(800,1100,600,1000,'зеркало');obj(1480,1300,690,1100,'шкаф WC');obj(1480,0,690,1200,'короб WC')
 text(ox+w+12,oy+30,'2700*',18)
 for a,b in zip(zs,zs[1:]):dim(ox+a*s,oy+h+36,(b-a)*s,str(b-a))
 text(x+15,878,'По ширине: '+ ' + '.join(str(b-a) for a,b in zip(zs,zs[1:])),21)
 text(x+15,915,'По высоте: '+ ' + '.join(str(b-a) for a,b in zip(ys,ys[1:])),21)
 lines=[['Горизонтальный рисунок','Два вертикальных шва на этой стене','Плита 1200 мм по длинной стороне'],['Вертикальный рисунок','Два горизонтальных шва на этой стене','Тот же формат, другое направление'],['Квадратная сетка','Больше швов при той же площади','Плита 600 мм по обеим сторонам']][i]
 for j,t in enumerate(lines):text(x+15,982+36*j,t,22,bold=j==0)
rect(65,1116,25,25,'#e5d3b4');text(105,1137,'Поля с подрезкой. Их окраска — пояснение схемы; вся плитка остаётся одного светлого камня.',22)
text(65,1191,'Швы и контуры усилены для чтения. Раскладку коробов, углов и стены с дверью уточним после выбора направления.',21)
p.append('</svg>');(ROOT/'a3-tile-elevations.svg').write_text('\n'.join(p))
