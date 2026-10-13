import type {Prisma} from '@prisma/client';
export async function countOpenCharacterReports(reader: Prisma.TransactionClient, ids: string[]) {
  const counts = await reader.report.groupBy({by: ['targetId'], where: {targetType: 'CHARACTER', status: {in: ['OPEN', 'REVIEWING']}, targetId: {in: ids}}, _count: {_all: true}});
  return new Map(counts.map(row => [row.targetId, row._count._all]));
}
