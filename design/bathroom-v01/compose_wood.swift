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
text("A3 / M1 / T1 · ДЕРЕВО В ИНТЕРЬЕРЕ",55,32,49,true)
text("Меняются только оттенок и рисунок деревянных поверхностей. Расстановка, плитка, камера и свет одинаковые.",55,102,29)
let names=["Д1  Светлый дуб","Д2  Натуральный дуб","Д3  Орех"]
for (i,v) in ["D1","D2","D3"].enumerated(){
 let x=Double(i*900)
 text(names[i],x+40,164,34,true)
 for (j,_) in ["bath"].enumerated(){
  let im=NSImage(contentsOf:root.appendingPathComponent("a3-wood-\(v)-main.png"))!
  im.draw(in:NSRect(x:x,y:220+Double(j)*920,width:900,height:900),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
 }
 let rows=[
 ["Светлый, приглушённый древесный тон", "Меньше контраста со светлым камнем", "Тумба и колонна выглядят легче", "Подойдёт для максимально спокойной палитры"],
 ["Тёплый дуб средней насыщенности", "Дерево читается, но не доминирует", "Связывает тумбу и колонну в одну композицию", "Мой основной кандидат для M1"],
 ["Глубокий коричневый древесный тон", "Самый сильный контраст с камнем", "Колонна становится заметным акцентом", "Более выразительная мебельная композиция"]
 ]
 for (j,t) in rows[i].enumerated(){text(t,x+35,1160+Double(j)*44,27,j==0)}
}
text("Это выбор декора, а не материала основы. Каждый тон можно искать среди ламинированных декоров или шпона.",55,1370,27)
text("Рисунок дерева условный, не образец производителя. Цвета проверим по физическим образцам при выбранном свете.",55,1420,26)
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:root.appendingPathComponent("bathroom-a3-wood.png"))
