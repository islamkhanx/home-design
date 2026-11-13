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
text("A3 / M1 · ТРИ РАСКЛАДКИ ПЛИТКИ",55,32,49,true)
text("Один светлый камень. Сравниваем только формат и направление швов. Пол во всех вариантах — 60 × 60 см.",55,102,29)
let names=["T1  60 × 120 горизонтально","T2  60 × 120 вертикально","T3  60 × 60"]
for (i,v) in ["T1","T2","T3"].enumerated(){
 let x=Double(i*900)
 text(names[i],x+40,164,34,true)
 for (j,_) in ["bath"].enumerated(){
  let im=NSImage(contentsOf:root.appendingPathComponent("a3-tile-\(v)-main.png"))!
  im.draw(in:NSRect(x:x,y:220+Double(j)*920,width:900,height:900),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
 }
 let rows=[
 ["Широкие горизонтальные поля", "Сдержанный прямой рисунок без смещения", "По ширине стены: 635 + 1200 + 635 мм*", "Верхнее поле по высоте — 300 мм*"],
 ["Вытянутые вертикальные поля", "Меньше горизонтальных линий", "По ширине: 335 + 600 + 600 + 600 + 335 мм*", "Верхнее поле по высоте — 300 мм*"],
 ["Регулярная квадратная сетка", "Больше швов; более дробная поверхность", "По ширине: 335 + 600 + 600 + 600 + 335 мм*", "Верхнее поле по высоте — 300 мм*"]
 ]
 for (j,t) in rows[i].enumerated(){text(t,x+35,1160+Double(j)*44,27,j==0)}
}
text("* Размеры полей по модульной сетке, до учёта калибра и примыканий. Это сравнение раскладок, не карта реза.",55,1370,27)
text("Размеры комнаты условные. Швы показаны контрастнее для сравнения. Группы света: потолок и зеркало; без ночной подсветки.",55,1420,26)
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:root.appendingPathComponent("bathroom-a3-tiles.png"))
