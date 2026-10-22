import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { toPublicUser, User } from '../common/entities/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './dto';

export interface AuthResult {
  token: string;
  user: ReturnType<typeof toPublicUser>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('这个邮箱已经注册过了，直接登录即可。');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create(dto.email, passwordHash, dto.displayName);
    return this.sign(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email, true);
    if (!user) {
      throw new UnauthorizedException('邮箱或密码不对，请再试一次。');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('邮箱或密码不对，请再试一次。');
    }
    return this.sign(user);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('账号不存在，请重新登录。');
    return toPublicUser(user);
  }

  private async sign(user: User): Promise<AuthResult> {
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { token, user: toPublicUser(user) };
  }
}
