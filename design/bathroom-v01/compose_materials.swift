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
text("A3 · ГДЕ КАМЕНЬ, ГДЕ ДЕРЕВО",55,32,49,true)
text("Сантехника и шкафы на прежних местах. Меняется только распределение отделки. Свет и экспозиция одинаковые.",55,102,29)
let names=["M1  Единый камень","M2  Акцент на полу","M3  Акцентная стена"]
for (i,v) in ["M1","M2","M3"].enumerated(){
 let x=Double(i*900)
 text(names[i],x+40,164,34,true)
 for (j,_) in ["bath"].enumerated(){
  let im=NSImage(contentsOf:root.appendingPathComponent("a3-material-\(v)-main.png"))!
  im.draw(in:NSRect(x:x,y:220+Double(j)*920,width:900,height:900),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
 }
 let rows=[
 ["Один светлый камень: стены + пол", "Дерево: тумба и высокий шкаф", "Светлый фасад: шкаф над WC", "Самая цельная и спокойная композиция"],
 ["Светлый камень стен + более тёмный пол", "Дерево: только тумба", "Оба высоких / верхних шкафа светлые", "Меньше дерева; два вида керамогранита"],
 ["Более тёмный камень на левой стене и коробе WC", "Остальные стены и пол — светлый камень", "Дерево: тумба и высокий шкаф", "Сантехника выделяется на общем фоне"]
 ]
 for (j,t) in rows[i].enumerated(){text(t,x+35,1160+Double(j)*44,27,j==0)}
}
text("Во всех: матовый керамогранит + эпоксидная затирка. Две группы света: потолок и зеркало. Подсветки под тумбой нет.",55,1370,27)
text("Цвета схематичны, не образцы коллекций. Выбираем зоны материалов; фактуру, форматы плитки и узлы уточним дальше.",55,1420,26)
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:root.appendingPathComponent("bathroom-a3-materials.png"))
