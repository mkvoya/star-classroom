export type Member = { id: string; name: string; online: boolean; submitted: boolean; participating: boolean; answer?: string };
export type Classroom = { code: string; teacherName: string; role: 'teacher' | 'student'; myId: string | null; round: number; status: 'waiting' | 'answering' | 'revealed'; members: Member[]; submitted: number; total: number; ownAnswer: string | null; revision: number };
