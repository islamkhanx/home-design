import AppKit
import Foundation
let root=URL(fileURLWithPath:CommandLine.arguments[1]);let w=2700,h=1500
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w,pixelsHigh:h,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
let ctx=NSGraphicsContext(bitmapImageRep:bitmap)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=ctx
ctx.cgContext.translateBy(x:0,y:CGFloat(h));ctx.cgContext.scaleBy(x:1,y:-1)
NSGraphicsContext.current=NSGraphicsContext(cgContext:ctx.cgContext,flipped:true)
NSColor(srgbRed:0.96,green:0.95,blue:0.93,alpha:1).setFill();NSRect(x:0,y:0,width:w,height:h).fill()
func text(_ s:String,_ x:Double,_ y:Double,_ size:Double=30,_ bold:Bool=false){
 (s as NSString).draw(at:NSPoint(x:x,y:y),withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:bold ? .semibold:.regular),.foregroundColor:NSColor(srgbRed:0.19,green:0.25,blue:0.23,alpha:1)])
}
text("РАССТАНОВКА A · ТРИ КОМПОЗИЦИИ",55,32,49,true)
text("Ванна, раковина, WC и стиралка остаются на месте. Сравниваем шкафы, зеркало и распределение материалов.",55,102,29)
let names=["A1  Отдельные блоки","A2  Большое зеркало","A3  Хозяйственная колонна"]
for (i,v) in ["A1","A2","A3"].enumerated(){
 let x=Double(i*900)
 text(names[i],x+40,164,34,true)
 for (j,view) in ["bath"].enumerated(){
  let im=NSImage(contentsOf:root.appendingPathComponent("a-composition-\(v)-\(view).png"))!
  im.draw(in:NSRect(x:x,y:220+Double(j)*920,width:900,height:900),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
 }
 let rows=[
 ["Тумба + 2 верхних шкафа", "Дерево: три отдельных акцента", "Зеркало только над раковиной", "Самая простая композиция из трёх"],
 ["Тумба + широкий зеркальный шкаф + шкаф СМ", "Дерево: только тумба; верхние фасады спокойные", "Зеркало и хранение объединяют левую стену", "Высоту зеркала и открывание дверец уточнить"],
 ["Тумба + шкаф WC + колонна со стиралкой", "Дерево: тумба и один высокий объём", "Стиралка за фасадом, хранение над ней", "Проверить дверцы, вентиляцию и сервисный доступ"]
 ]
 for (j,t) in rows[i].enumerated(){text(t,x+35,1160+Double(j)*44,27,j==0)}
}
text("Во всех: камень на стенах и полу; 3 группы света — основной / зеркало / ночной. Потолок и ближние стены скрыты.",55,1370,27)
text("Рабочая база A сохранена. Габариты помещения условные; формы сантехники и материалы схематичны. Это выбор композиции.",55,1420,26)
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:root.appendingPathComponent("bathroom-a-compositions.png"))
