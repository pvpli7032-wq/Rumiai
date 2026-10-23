export type SitePageBlock =
  | {type:'PARAGRAPH';text:string}
  | {type:'HEADING';text:string;level:2|3}
  | {type:'LINK';text:string;href:string}
  | {type:'NOTICE';text:string;tone:'INFO'|'WARNING'}
  | {type:'BUTTON';text:string;href:string;variant:'PRIMARY'|'SECONDARY'}
  | {type:'CARD_GRID';heading:string;cards:Array<{title:string;description:string;href:string;actionLabel:string}>}
  | {type:'IMAGE';src:string;alt:string;caption:string}
  | {type:'LIST';ordered:boolean;items:string[]};
