import { zhText } from '@/lib/zh-text';
import { REPORT_CATEGORIES, IMAGE_REASONS, COPYRIGHT_RELATIONSHIPS } from './reports';

/**
 * Thai labels for the report taxonomy. The keys come from the live site's own dictionary
 * (see src/lib/reports.ts), so this file only supplies the wording — never the set.
 */
export const CATEGORY_LABELS: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  sexualContent: zhText("เนื้อหาทางเพศ"),
  violence: zhText("ความรุนแรง"),
  hateSpeech: zhText("ถ้อยคำสร้างความเกลียดชัง"),
  underageContent: zhText("เนื้อหาเกี่ยวกับผู้เยาว์"),
  animalAbuse: zhText("ทารุณกรรมสัตว์"),
  inappropriateImage: zhText("รูปภาพไม่เหมาะสม"),
  copyright: zhText("ละเมิดลิขสิทธิ์"),
  impersonation: zhText("แอบอ้างเป็นผู้อื่น"),
  spam: zhText("สแปม"),
  abuse: zhText("คุกคาม/กลั่นแกล้ง"),
  inappropriateContent: zhText("เนื้อหาไม่เหมาะสม"),
  availableOnOtherPlatform: zhText("มีอยู่บนแพลตฟอร์มอื่น"),
  other: zhText("อื่นๆ"),
};

export const IMAGE_REASON_LABELS: Record<(typeof IMAGE_REASONS)[number], string> = {
  realPerson: zhText("เป็นรูปบุคคลจริง"),
  explicit: zhText("ภาพโป๊เปลือย"),
  violent: zhText("ภาพความรุนแรง"),
  other: zhText("อื่นๆ"),
};

export const RELATIONSHIP_LABELS: Record<(typeof COPYRIGHT_RELATIONSHIPS)[number], string> = {
  owner: zhText("ฉันเป็นเจ้าของลิขสิทธิ์"),
  licensee: zhText("ฉันได้รับอนุญาตให้ใช้สิทธิ์"),
  witness: zhText("ฉันเป็นผู้พบเห็น"),
};
