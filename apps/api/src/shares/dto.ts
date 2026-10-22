import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateShareDto {
  @IsUUID('4', { message: '歌单 ID 不对。' })
  playlistId: string;

  @IsOptional()
  @IsIn(['view', 'clone'])
  permission?: 'view' | 'clone';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  expiresInDays?: number;
}

export class CloneShareDto {
  @IsOptional()
  @IsUUID('4')
  playlistId?: string;
}
