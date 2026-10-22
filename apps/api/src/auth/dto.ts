import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址。' })
  @MaxLength(190, { message: '邮箱太长了。' })
  email: string;

  @IsString({ message: '请输入密码。' })
  @MinLength(8, { message: '密码至少 8 位。' })
  @MaxLength(72, { message: '密码不能超过 72 位。' })
  password: string;

  @IsString({ message: '请输入昵称。' })
  @MinLength(1, { message: '请输入昵称。' })
  @MaxLength(40, { message: '昵称最多 40 个字符。' })
  displayName: string;
}

export class LoginDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址。' })
  email: string;

  @IsString({ message: '请输入密码。' })
  @MinLength(1, { message: '请输入密码。' })
  password: string;
}
