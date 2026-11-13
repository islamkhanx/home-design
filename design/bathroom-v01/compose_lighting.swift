import AppKit
import Foundation
let root=URL(fileURLWithPath:CommandLine.arguments[1]);let w=1800,h=1500
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w,pixelsHigh:h,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
let ctx=NSGraphicsContext(bitmapImageRep:bitmap)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=ctx
ctx.cgContext.translateBy(x:0,y:CGFloat(h));ctx.cgContext.scaleBy(x:1,y:-1)
NSGraphicsContext.current=NSGraphicsContext(cgContext:ctx.cgContext,flipped:true)
NSColor(srgbRed:0.96,green:0.95,blue:0.93,alpha:1).setFill();NSRect(x:0,y:0,width:w,height:h).fill()
func text(_ s:String,_ x:Double,_ y:Double,_ size:Double=30,_ bold:Bool=false){
 (s as NSString).draw(at:NSPoint(x:x,y:y),withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:bold ? .semibold:.regular),.foregroundColor:NSColor(srgbRed:0.19,green:0.25,blue:0.23,alpha:1)])
}
text("A3 · ДВА СЦЕНАРИЯ СВЕТА",55,32,49,true)
text("Одна расстановка и одни светильники. Во всех кадрах одинаковые камера и экспозиция.",55,102,29)
let names=["01  Основной", "02  Вечерний"]
for (i,v) in ["main","evening"].enumerated(){
 let x=Double(i*900)
 text(names[i],x+40,164,34,true)
 for (j,_) in ["bath"].enumerated(){
  let im=NSImage(contentsOf:root.appendingPathComponent("a3-light-\(v).png"))!
  im.draw(in:NSRect(x:x,y:220+Double(j)*920,width:900,height:900),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
 }
 let rows=[
 ["Потолок + свет у зеркала", "Для обычных дел и уборки", "Две потолочные точки включены", "Подсветки под тумбой нет"],
 ["Только приглушённое зеркало", "Для спокойного вечернего света", "Потолочные точки выключены", "Подсветки под тумбой нет"]
 ]
 for (j,t) in rows[i].enumerated(){text(t,x+35,1160+Double(j)*44,27,j==0)}
}
text("Предложение: 2 независимые группы, 4 источника. Подсветка под тумбой исключена.",55,1370,25)
text("Габариты условные. Это сравнение характера света, не расчёт освещённости. Потолок и ближние стены скрыты.",55,1420,23)
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:root.appendingPathComponent("bathroom-a3-lighting.png"))
